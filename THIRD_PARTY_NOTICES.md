# Third-party notices

Troupe's own code is MIT licensed. Some distributions include third-party
programs under other licenses:

- **FFmpeg / FFprobe.** The Docker image installs Alpine Linux's `ffmpeg`
  package; Vercel builds bundle the static `ffprobe` binary from
  [`@ffprobe-installer/linux-x64`](https://www.npmjs.com/package/@ffprobe-installer/linux-x64).
  Both are built from [FFmpeg](https://ffmpeg.org) and licensed under the GNU
  GPL (version 2 or later, or version 3 for some builds). Troupe runs them as
  separate programs. Their source is available from
  [ffmpeg.org](https://ffmpeg.org/download.html) and the
  [Alpine aports](https://gitlab.alpinelinux.org/alpine/aports) repository.
- **ComfyUI workflows.** `src/modules/generation/server/adapters/comfyui/templates/*.json`
  are derived from [Comfy-Org/workflow_templates](https://github.com/Comfy-Org/workflow_templates)
  (MIT). The model weights they reference are not distributed with Troupe and
  carry their own licenses (LTX-2: LTX-2 Community License Agreement, free for
  commercial use under a revenue threshold; Wan 2.2:
  Apache 2.0).
- **Kokoro-82M voice model.** The in-browser renderer (browser edition) and the
  local renderer (`renderer/`) download
  [`onnx-community/Kokoro-82M-v1.0-ONNX`](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX),
  an ONNX export of [`hexgrad/Kokoro-82M`](https://huggingface.co/hexgrad/Kokoro-82M),
  weights and voice files, from Hugging Face at run time. Both model cards
  declare the Apache License 2.0. Troupe does not distribute the weights.
- **Speech and video libraries bundled into the browser edition** (`site/dist`,
  in the render worker), also used by the local renderer:
  - [kokoro-js](https://github.com/hexgrad/kokoro) 1.2.1: Apache License 2.0.
  - [phonemizer](https://github.com/xenova/phonemizer.js) 1.2.1: published
    under the Apache License 2.0, it embeds [eSpeak NG](https://github.com/espeak-ng/espeak-ng)
    compiled to WebAssembly, with its language data. eSpeak NG is licensed
    under the GNU GPL version 3 or later; its source is available from that
    repository.
  - [Transformers.js](https://github.com/huggingface/transformers.js)
    (`@huggingface/transformers`) 3.8.1: Apache License 2.0.
  - [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) 1.22
    (`onnxruntime-web`), including its WebAssembly binary, which the site
    serves itself: MIT License.
  - [Mediabunny](https://github.com/Vanilagy/mediabunny) 1.61: Mozilla Public
    License 2.0. Bundled unmodified; its source is available from that
    repository and npm.
- **Geist font.** The browser edition ships Geist (`@fontsource-variable/geist`)
  and draws the video captions with it; the local renderer ships it too
  (`@fontsource/geist-sans`). Geist is licensed under the SIL Open Font
  License 1.1.
- **Bricolage Grotesque and JetBrains Mono fonts.** The browser edition and
  its landing page ship them (`@fontsource-variable/bricolage-grotesque`,
  `@fontsource-variable/jetbrains-mono`), and the presentation video's title
  cards are drawn with them. Both are licensed under the SIL Open Font License
  1.1.
- **Script chat.**
  - [WebLLM](https://github.com/mlc-ai/web-llm) (`@mlc-ai/web-llm`) 0.2.85:
    Apache License 2.0. Bundled into the browser edition (a worker chunk and a
    chunk loaded when the chat is first used). At run time it fetches the
    model's compiled WebGPU library from
    [mlc-ai/binary-mlc-llm-libs](https://github.com/mlc-ai/binary-mlc-llm-libs)
    (Apache License 2.0).
  - Qwen2.5-1.5B-Instruct weights, the browser edition's default chat model, downloaded
    by the visitor's browser from
    [`mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC`](https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC),
    a quantization of [`Qwen/Qwen2.5-1.5B-Instruct`](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct),
    whose model card declares the Apache License 2.0 (other Qwen2.5 sizes,
    such as 3B and 72B, use other licenses). Troupe does not distribute the
    weights.
  - The self-hosted chat's default Ollama model, `qwen3:4b`
    ([Qwen/Qwen3-4B](https://huggingface.co/Qwen/Qwen3-4B), Apache License
    2.0), is pulled by the user with Ollama ([MIT](https://github.com/ollama/ollama/blob/main/LICENSE)),
    which Troupe neither bundles nor installs.
  - [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript)
    (`@anthropic-ai/sdk`) 0.131.0: MIT License. Used by the self-hosted
    server only; messages to Claude are billed by Anthropic to the key's owner.
- **The local renderer's AI video mode** (`renderer/ltx/`, opt-in, never in
  the Docker images). Troupe distributes none of the following; `uv` installs
  the Python packages into `renderer/ltx/.venv` and Hugging Face serves the
  weights when the user runs `pnpm renderer:ltx:setup` or the mode's first job.
  - LTX-Video 2B 0.9.8 distilled weights
    (`ltxv-2b-0.9.8-distilled.safetensors` from
    [`Lightricks/LTX-Video`](https://huggingface.co/Lightricks/LTX-Video)):
    [LTXV Open Weights License 0.X](https://huggingface.co/Lightricks/LTX-Video/blob/main/LTX-Video-Open-Weights-License-0.X.txt)
    by Lightricks Ltd., not an open-source license. It grants a royalty-free
    license "for any purpose" except that "entities with annual revenues of
    at least $10,000,000" need a paid commercial license, and it binds every
    use to the restrictions of its Attachment A, which anyone redistributing
    the model must pass on. Among them, not to use the model "To generate or
    disseminate information and/or content … without expressly and
    intelligibly disclaiming that the information and/or content is machine
    generated", nor "To impersonate or attempt to impersonate (e.g.
    deepfakes) others without their consent". The 2B 0.9.5 checkpoint, which
    `LTX_MODEL` can select, uses Lightricks' Open RAIL-M license (March 5,
    2025) instead: commercial use with no revenue threshold, under much the
    same use restrictions.
  - T5 v1.1 XXL text encoder and tokenizer, loaded from
    [`Lightricks/LTX-Video-0.9.5`](https://huggingface.co/Lightricks/LTX-Video-0.9.5)
    (a copy of [`google/t5-v1_1-xxl`](https://huggingface.co/google/t5-v1_1-xxl)'s
    encoder, whose model card declares the Apache License 2.0). The LTX-Video
    0.9.5 scheduler and model configs come from the same repository.
  - [PyTorch](https://github.com/pytorch/pytorch) 2.14: BSD 3-Clause License;
    its wheels bundle third-party code under the Apache License 2.0 (some
    with the LLVM exception), BSD 2-Clause, Boost (BSL-1.0) and MIT licenses.
  - [Diffusers](https://github.com/huggingface/diffusers) 0.40,
    [Transformers](https://github.com/huggingface/transformers) 5.18,
    [Accelerate](https://github.com/huggingface/accelerate) 1.15,
    [huggingface_hub](https://github.com/huggingface/huggingface_hub) 1.33,
    [safetensors](https://github.com/huggingface/safetensors) 0.8,
    [tokenizers](https://github.com/huggingface/tokenizers) 0.23 and
    [SentencePiece](https://github.com/google/sentencepiece) 0.2: Apache
    License 2.0.
  - [NumPy](https://github.com/numpy/numpy) 2.5: BSD 3-Clause License (with
    bundled code under 0BSD, MIT, Zlib and CC0-1.0).
  - [Protocol Buffers](https://github.com/protocolbuffers/protobuf) (`protobuf`)
    7.36, which Transformers needs to read the T5 tokenizer: BSD 3-Clause
    License.
  - Their other dependencies, pinned in `renderer/ltx/uv.lock`, keep their
    own licenses, listed in the installed packages' metadata.
- **The actors' pictures** (`public/actors/`, 180 WebP files, plus 60
  smaller copies of the front pictures made from them with cwebp). They show
  synthetic people: no real person was photographed or described by name,
  and any resemblance to a real person is coincidental. They are released
  under this repository's MIT license. They were generated on a Mac with
  `scripts/actors/generate.py`, which Troupe does not run; `uv` installs its
  Python packages and Hugging Face serves the weights when someone runs it:
  - FLUX.2 [klein] 4B by Black Forest Labs
    ([`black-forest-labs/FLUX.2-klein-4B`](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)),
    Apache License 2.0, including its Qwen3 text encoder; used as the
    8-bit MLX conversion
    [`mflux-community/flux2-klein-4b-mflux-q8`](https://huggingface.co/mflux-community/flux2-klein-4b-mflux-q8),
    which keeps that license. The model card places no restriction on the
    images it makes. (FLUX.2 [klein] 9B uses Black Forest Labs' non-commercial
    license and is not used.)
  - [MFLUX](https://github.com/filipstrand/mflux) 0.21.0 (MIT License) on
    [MLX](https://github.com/ml-explore/mlx) 0.32 (MIT License), and
    [Pillow](https://github.com/python-pillow/Pillow) (MIT-CMU License) for
    the WebP files. Their other dependencies, pinned in
    `scripts/actors/uv.lock`, keep their own licenses.
- Other npm dependencies keep their own licenses, listed in `node_modules`.
