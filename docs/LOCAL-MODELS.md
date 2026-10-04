# Local models

Troupe can render on your own hardware in two ways: through
[ComfyUI](https://github.com/comfyanonymous/ComfyUI), or through any HTTP server
that follows a small contract. Add either in **Settings → Local models**, press
**Test**, then **Add model**. Local models appear next to the cloud ones in every
picker, estimate at $0 and get a two-hour time limit, since a single GPU works
through one job at a time.

Addresses may be on your machine or your network (`127.0.0.1`, `192.168.x.x`,
`comfyui`, …). Link-local addresses and cloud metadata endpoints are refused. A
token, if you set one, is encrypted at rest and only ever sent to that address.

## ComfyUI

### Where ComfyUI runs

ComfyUI Desktop listens on port 8000; ComfyUI started from the command line
(`python main.py`) listens on 8188. The form prefills the most likely address
for where Troupe runs: `host.docker.internal:8188` in Docker, port 8000 under
`pnpm dev` on a Mac, port 8188 elsewhere.

| Setup | Address to enter |
|---|---|
| ComfyUI on the computer running Troupe's Docker stack | `http://host.docker.internal:8188` (ComfyUI Desktop: `http://host.docker.internal:8000`) |
| `docker compose --profile comfyui up -d` (NVIDIA GPU) | `http://comfyui:8188` |
| `pnpm dev` and ComfyUI Desktop on the same machine | `http://127.0.0.1:8000` |
| `pnpm dev` and command-line ComfyUI on the same machine | `http://127.0.0.1:8188` |
| Another machine on your network | `http://<its address>:8188` (start ComfyUI with `--listen 0.0.0.0`) |

### Bundled workflows

Both come from ComfyUI's own templates (comfyui-workflow-templates 0.11.76),
exported with **Workflow → Export (API)** from ComfyUI 0.38.0. Troupe fills in
the prompt, size, frame count, frame rate, seed and output name.

| | LTX-2 | Wan 2.2 TI2V 5B |
|---|---|---|
| Audio | generated with the video (voice and sound) | none: the actor mimes |
| Formats | 9:16, 16:9, 1:1 at 720p or 1080p | 9:16, 16:9 at 720p |
| Lengths | 4, 5, 6, 8, 10 s at 24 fps | 3, 4, 5 s at 24 fps |
| GPU memory | plan on 24 GB | 8–12 GB; runs on Apple Silicon |
| Model files | about 42 GB | about 17 GB |
| Status | validated by ComfyUI, not yet rendered end to end | validated by ComfyUI, not yet rendered end to end |

"Validated" means ComfyUI 0.38.0 accepted the filled-in workflow and only
reported the missing model files. Please report a full render either way.

Model files go under ComfyUI's `models/` folder. **Test** lists the ones missing
with their download links.

**LTX-2** (`Lightricks/LTX-2`):

- `checkpoints/ltx-2-19b-dev-fp8.safetensors`
- `text_encoders/gemma_3_12B_it_fp4_mixed.safetensors`
- `loras/ltx-2-19b-distilled-lora-384.safetensors`
- `latent_upscale_models/ltx-2-spatial-upscaler-x2-1.0.safetensors`

**Wan 2.2 TI2V 5B**:

- `diffusion_models/wan2.2_ti2v_5B_fp16.safetensors`
- `text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors`
- `vae/wan2.2_vae.safetensors`

### Your own workflow

1. Build it in ComfyUI and make it end with **Save Video** set to `mp4` / `h264`
   (or Video Combine with `video/h264-mp4`). Troupe refuses other formats.
2. Put placeholders in the inputs Troupe should fill:

   | Placeholder | Value |
   |---|---|
   | `{{prompt}}` | the compiled dialogue prompt (required) |
   | `{{negative_prompt}}` | empty unless set |
   | `{{width}}`, `{{height}}` | pixels for the chosen format and resolution |
   | `{{frames}}` | length × fps, rounded to your frame rule (any, 4n+1, 8n+1) |
   | `{{fps}}`, `{{duration_s}}` | frame rate, seconds |
   | `{{seed}}` | a random seed per render |
   | `{{filename_prefix}}` | a unique output name |

   A value that is exactly `"{{width}}"` becomes a number, not text.
3. **Workflow → Export (API)** and import that file (2 MB at most). The regular
   "Save" format is refused with a reminder.
4. Describe what it can render (formats, resolutions, lengths, audio), test,
   add.

When a ComfyUI restart loses a queued job, Troupe marks the render failed
instead of waiting for it.

## HTTP endpoint

Any server, in any language, can be a Troupe model by answering three
requests. `examples/http-model/server.mjs` is a working example (it renders a
test pattern with ffmpeg) to start from.

All requests carry `Authorization: Bearer <token>` when a token is set.

### `GET /health`

```json
{ "ok": true, "contract": 1 }
```

### `POST /jobs`

```json
{
  "prompt": "UGC-style ad, single actor speaking to camera. …",
  "aspect_ratio": "9:16",
  "resolution": "720p",
  "width": 720,
  "height": 1280,
  "duration_s": 6,
  "fps": 24,
  "audio": true
}
```

`fps` is sent when set on the model. Answer with an id:

```json
{ "id": "job-123" }
```

### `GET /jobs/{id}`

```json
{ "status": "running", "progress": 0.4 }
```

`status` is `queued`, `running`, `succeeded` or `failed`. On success add
`video_url`; on failure, `error` (a short message shown to the user).

```json
{ "status": "succeeded", "video_url": "/files/job-123.mp4" }
```

`video_url` may be relative, and must be on the same origin as the server:
Troupe refuses to follow it anywhere else and does not follow redirects. The
file must be an MP4 of at most 200 MB.

Troupe polls every 20 seconds at first, then less often, for up to two hours by
default (change it in the model's settings).
