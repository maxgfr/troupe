"""Generates one LTX-Video clip for Troupe's renderer (renderer/src/ltx.ts).

The renderer runs this script once per job with uv and writes the job to its
stdin as JSON:

    {"prompt": "...", "negative_prompt": "...", "width": 480, "height": 832,
     "num_frames": 121, "frame_rate": 24, "seed": 42, "out": "/tmp/clip.mp4"}

It answers with one JSON object per line on stdout:

    {"stage": "text" | "load" | "denoise" | "decode" | "write"}
    {"step": 3, "steps": 8}
    {"done": true, "frames": 121, "width": 480, "height": 832,
     "seconds": 95.2, "peak_rss_mb": 9500}

and writes the clip, silent H.264, to `out` through ffmpeg. Errors go to
stderr with a non-zero exit code.

The model is set by environment variables (docs/LOCAL-MODELS.md):

    LTX_MODEL                 transformer + VAE: a diffusers repo or a single
                              .safetensors file (URL or path)
    LTX_BASE_MODEL            diffusers repo for the configs, tokenizer, text
                              encoder and scheduler
    LTX_TEXT_ENCODER          repo of the T5 text encoder (default: the base
                              model's text_encoder folder)
    LTX_DEVICE                mps, cuda or cpu (default: the best available)
    LTX_TEXT_ENCODER_DEVICE   where T5 runs (default: LTX_DEVICE)
    LTX_DTYPE                 bfloat16, float16 or float32
    LTX_STEPS, LTX_TIMESTEPS  denoising steps, or an explicit timestep list
    LTX_GUIDANCE              classifier-free guidance; 1 turns it off
    LTX_VAE_TILING            1 decodes the video in tiles, across the frame
                              and across time (less memory)
    LTX_PROMPT_CACHE          folder for encoded prompts ("" turns it off)

    uv run python generate.py --download   fetches the weights and exits.
"""

from __future__ import annotations

import gc
import hashlib
import json
import os
import resource
import shutil
import subprocess
import sys
import time
from pathlib import Path

DEFAULT_MODEL = "https://huggingface.co/Lightricks/LTX-Video/blob/main/ltxv-2b-0.9.8-distilled.safetensors"
DEFAULT_BASE_MODEL = "Lightricks/LTX-Video-0.9.5"
# The distilled checkpoints' first-pass schedule (diffusers' LTX-Video docs).
DISTILLED_TIMESTEPS = "1000,993,987,981,975,909,725,0.03"
DTYPES = ("bfloat16", "float16", "float32")
DEVICES = ("mps", "cuda", "cpu")


def emit(**event) -> None:
    print(json.dumps(event), flush=True)


def fail(message: str) -> None:
    print(message, file=sys.stderr, flush=True)
    sys.exit(1)


def env(name: str, default: str) -> str:
    value = os.environ.get(name, "").strip()
    return value or default


def settings() -> dict:
    """The model settings from the environment, checked."""
    dtype = env("LTX_DTYPE", "bfloat16")
    if dtype not in DTYPES:
        fail(f"LTX_DTYPE must be one of {', '.join(DTYPES)} (got {dtype!r}).")
    device = env("LTX_DEVICE", "auto")
    if device not in (*DEVICES, "auto"):
        fail(f"LTX_DEVICE must be one of {', '.join(DEVICES)} (got {device!r}).")
    text_device = env("LTX_TEXT_ENCODER_DEVICE", device)
    if text_device not in (*DEVICES, "auto"):
        fail(f"LTX_TEXT_ENCODER_DEVICE must be one of {', '.join(DEVICES)} (got {text_device!r}).")
    raw_timesteps = os.environ.get("LTX_TIMESTEPS", DISTILLED_TIMESTEPS).strip()
    try:
        timesteps = [float(t) for t in raw_timesteps.split(",")] if raw_timesteps else None
        steps = int(env("LTX_STEPS", str(len(timesteps)) if timesteps else "40"))
        guidance = float(env("LTX_GUIDANCE", "1"))
    except ValueError:
        fail("LTX_TIMESTEPS must be comma-separated numbers, LTX_STEPS a whole number and LTX_GUIDANCE a number.")
    if steps < 1 or steps > 200:
        fail(f"LTX_STEPS must be between 1 and 200 (got {steps}).")
    return {
        "model": env("LTX_MODEL", DEFAULT_MODEL),
        "base_model": env("LTX_BASE_MODEL", DEFAULT_BASE_MODEL),
        "text_encoder": env("LTX_TEXT_ENCODER", ""),
        "dtype": dtype,
        "device": device,
        "text_device": text_device,
        "timesteps": timesteps,
        "steps": steps,
        "guidance": guidance,
        "vae_tiling": env("LTX_VAE_TILING", "1") not in ("0", "false", "no"),
        "prompt_cache": os.environ.get("LTX_PROMPT_CACHE", str(Path.home() / ".cache" / "troupe-renderer" / "ltx-prompts")).strip(),
    }


def pick_device(name: str):
    import torch

    if name != "auto":
        if name == "mps" and not torch.backends.mps.is_available():
            fail("LTX_DEVICE is mps but PyTorch sees no Apple GPU here (MPS needs macOS on Apple Silicon, not Docker).")
        if name == "cuda" and not torch.cuda.is_available():
            fail("LTX_DEVICE is cuda but PyTorch sees no NVIDIA GPU.")
        return torch.device(name)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def free(device) -> None:
    import torch

    gc.collect()
    if device.type == "mps":
        torch.mps.empty_cache()
    elif device.type == "cuda":
        torch.cuda.empty_cache()


def single_file(model: str) -> bool:
    return model.endswith(".safetensors")


def download(cfg: dict) -> None:
    """Fetches everything a render needs into the Hugging Face cache."""
    from huggingface_hub import hf_hub_download, snapshot_download

    base_files = ["model_index.json", "scheduler/*", "tokenizer/*", "transformer/config.json", "vae/config.json"]
    if not cfg["text_encoder"]:
        base_files.append("text_encoder/*")
    snapshot_download(cfg["base_model"], allow_patterns=base_files)
    if cfg["text_encoder"]:
        snapshot_download(cfg["text_encoder"])
    model = cfg["model"]
    if single_file(model):
        if model.startswith("https://huggingface.co/"):
            repo, _, path = model.removeprefix("https://huggingface.co/").partition("/blob/main/")
            hf_hub_download(repo, path)
    else:
        snapshot_download(model, allow_patterns=["transformer/*", "vae/*"])


def encode_prompt(cfg: dict, job: dict, dtype, device):
    """T5 embeddings for the prompt (and the negative prompt under guidance),
    on the CPU, cached on disk: loading T5 is the most memory a render takes.
    """
    import torch

    guided = cfg["guidance"] > 1
    key = hashlib.sha256(
        json.dumps([cfg["base_model"], cfg["text_encoder"], cfg["dtype"], job["prompt"], job["negative_prompt"] if guided else ""]).encode()
    ).hexdigest()
    cache = Path(cfg["prompt_cache"]) / f"{key}.pt" if cfg["prompt_cache"] else None
    if cache and cache.exists():
        return torch.load(cache, map_location="cpu")

    emit(stage="text")
    from diffusers import LTXConditionPipeline
    from transformers import T5EncoderModel, T5TokenizerFast

    tokenizer = T5TokenizerFast.from_pretrained(cfg["base_model"], subfolder="tokenizer")
    if cfg["text_encoder"]:
        text_encoder = T5EncoderModel.from_pretrained(cfg["text_encoder"], dtype=dtype)
    else:
        text_encoder = T5EncoderModel.from_pretrained(cfg["base_model"], subfolder="text_encoder", dtype=dtype)
    text_device = pick_device(cfg["text_device"])
    text_encoder.to(text_device)
    encoder = LTXConditionPipeline(scheduler=None, vae=None, text_encoder=text_encoder, tokenizer=tokenizer, transformer=None)
    with torch.inference_mode():
        embeds, mask, negative_embeds, negative_mask = encoder.encode_prompt(
            prompt=job["prompt"],
            negative_prompt=job["negative_prompt"],
            do_classifier_free_guidance=guided,
            max_sequence_length=256,
            device=text_device,
            dtype=dtype,
        )
    prompt = {
        "prompt_embeds": embeds.cpu(),
        "prompt_attention_mask": mask.cpu(),
        **({"negative_prompt_embeds": negative_embeds.cpu(), "negative_prompt_attention_mask": negative_mask.cpu()} if guided else {}),
    }
    del encoder, text_encoder, embeds, mask, negative_embeds, negative_mask
    free(text_device)
    if cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        torch.save(prompt, cache)
    return prompt


def load_pipeline(cfg: dict, dtype, device):
    from diffusers import AutoencoderKLLTXVideo, FlowMatchEulerDiscreteScheduler, LTXConditionPipeline, LTXVideoTransformer3DModel

    model, base = cfg["model"], cfg["base_model"]
    if single_file(model):
        transformer = LTXVideoTransformer3DModel.from_single_file(model, config=base, subfolder="transformer", torch_dtype=dtype)
        vae = AutoencoderKLLTXVideo.from_single_file(model, config=base, subfolder="vae", torch_dtype=dtype)
    else:
        transformer = LTXVideoTransformer3DModel.from_pretrained(model, subfolder="transformer", torch_dtype=dtype)
        vae = AutoencoderKLLTXVideo.from_pretrained(model, subfolder="vae", torch_dtype=dtype)
    scheduler = FlowMatchEulerDiscreteScheduler.from_pretrained(base, subfolder="scheduler")
    pipe = LTXConditionPipeline(scheduler=scheduler, vae=vae, text_encoder=None, tokenizer=None, transformer=transformer)
    pipe.to(device)
    pipe.set_progress_bar_config(disable=True)
    if cfg["vae_tiling"]:
        # Tiles across the frame and across time: decoding all frames at once
        # would take most of a 16 GB Mac.
        pipe.vae.enable_tiling()
        pipe.vae.use_framewise_decoding = True
    return pipe


def write_video(frames, fps: int, out: str) -> None:
    """Pipes the frames (F × H × W × 3 floats in [0, 1]) into ffmpeg."""
    import numpy as np

    ffmpeg = os.environ.get("FFMPEG") or shutil.which("ffmpeg")
    if not ffmpeg:
        fail("ffmpeg is not installed on the renderer.")
    count, height, width, _ = frames.shape
    pixels = (np.clip(frames, 0, 1) * 255).round().astype(np.uint8)
    args = [ffmpeg, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{width}x{height}", "-r", str(fps), "-i", "pipe:0",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-pix_fmt", "yuv420p", out]
    done = subprocess.run(args, input=pixels.tobytes(), capture_output=True)
    if done.returncode != 0:
        fail(f"ffmpeg could not write the clip: {done.stderr.decode(errors='replace').strip()[:200]}")


def generate(cfg: dict, job: dict) -> None:
    import torch

    started = time.time()
    device = pick_device(cfg["device"])
    dtype = getattr(torch, cfg["dtype"])
    prompt = encode_prompt(cfg, job, dtype, device)

    emit(stage="load")
    pipe = load_pipeline(cfg, dtype, device)
    steps = len(cfg["timesteps"]) if cfg["timesteps"] else cfg["steps"]

    def on_step(_pipe, step, _timestep, kwargs):
        emit(step=step + 1, steps=steps)
        if step + 1 == steps:
            emit(stage="decode")
        return kwargs

    emit(stage="denoise")
    generator = torch.Generator(device="cpu").manual_seed(int(job["seed"]))
    with torch.inference_mode():
        frames = pipe(
            **{k: v.to(device) for k, v in prompt.items()},
            width=int(job["width"]),
            height=int(job["height"]),
            num_frames=int(job["num_frames"]),
            frame_rate=int(job["frame_rate"]),
            num_inference_steps=steps,
            timesteps=cfg["timesteps"],
            guidance_scale=cfg["guidance"],
            decode_timestep=0.05,
            decode_noise_scale=0.025,
            image_cond_noise_scale=0.0,
            generator=generator,
            output_type="np",
            callback_on_step_end=on_step,
        ).frames[0]
    del pipe
    free(device)

    emit(stage="write")
    write_video(frames, int(job["frame_rate"]), job["out"])
    # ru_maxrss is in bytes on macOS and in kilobytes on Linux.
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    peak_mb = peak / 1024 / 1024 if sys.platform == "darwin" else peak / 1024
    count, height, width, _ = frames.shape
    emit(done=True, frames=count, width=width, height=height, seconds=round(time.time() - started, 1), peak_rss_mb=round(peak_mb), device=device.type)


def read_job() -> dict:
    try:
        job = json.loads(sys.stdin.read())
    except json.JSONDecodeError as error:
        fail(f"The job on stdin is not JSON: {error}")
    required = ("prompt", "negative_prompt", "width", "height", "num_frames", "frame_rate", "seed", "out")
    missing = [k for k in required if k not in job]
    if missing:
        fail(f"The job is missing {', '.join(missing)}.")
    if int(job["width"]) % 32 or int(job["height"]) % 32:
        fail("width and height must be multiples of 32.")
    if (int(job["num_frames"]) - 1) % 8:
        fail("num_frames must be a multiple of 8, plus 1 (such as 97 or 121).")
    return job


def main() -> None:
    cfg = settings()
    if "--download" in sys.argv:
        download(cfg)
        print("LTX-Video weights are in the Hugging Face cache.", flush=True)
        return
    job = read_job()
    try:
        generate(cfg, job)
    except RuntimeError as error:
        text = str(error)
        if "out of memory" in text.lower() or "MPS backend out of memory" in text:
            fail("LTX ran out of memory. Lower LTX_RESOLUTION or LTX_FRAMES, or close other apps. " + text.splitlines()[0][:200])
        raise


if __name__ == "__main__":
    main()
