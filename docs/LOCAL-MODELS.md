# Local models

Troupe can render on your own hardware in two ways: through
[ComfyUI](https://github.com/comfyanonymous/ComfyUI), or through any HTTP server
that follows a small contract. The [local renderer](#local-renderer) in
`renderer/` is one such server that needs no GPU. Add either in **Settings → Local models**, press
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
{ "ok": true, "contract": 1, "poll_every_s": 1 }
```

`poll_every_s` is optional: how often, in seconds, Troupe should ask about a
job. **Test** reads it, shows it, and **Add model** saves it with the model;
testing a saved model again picks up a new value, and changing a model's
server forgets it until the next test. Troupe rounds it to whole seconds
between 1 and 60 and then polls at that steady pace from the first check on,
with no backoff. Without it, Troupe waits 20 seconds, then twice as long each
time, up to 5 minutes. Set it when your server finishes in seconds or
minutes; leave it out for jobs that take an hour.

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
  "audio": true,
  "script": {
    "language": "en",
    "actor": {
      "id": "6f1c0e8a-2b7d-4c1e-9a53-0d6e2f4b8c11",
      "name": "Léa",
      "gender": "female",
      "age_range": "18-24",
      "voice_profile": "warm and enthusiastic, mid-tempo"
    },
    "lines": [
      { "role": "hook", "text": "This ended my search for good coffee.", "emotion": "excited" },
      { "role": "cta", "text": "Grab yours today.", "emotion": "calm" }
    ]
  }
}
```

`fps` is sent when set on the model.

`script` is the script behind `prompt`, for servers that voice and stage it
themselves (text to speech, a portrait, captions) instead of reading the
compiled prompt. It is still contract 1: Troupe sends it with every job, and a
server that only reads `prompt` can ignore it.

- `language`: the language the lines are spoken in, e.g. `en` or `fr`.
- `actor`: who speaks. `id` is stable for a given actor, so it can key a
  voice or a portrait. `gender` is `female`, `male` or `nonbinary`;
  `age_range` is a range such as `25-34` or `55+`; `voice_profile` describes
  the delivery in a few words.
- `lines`: in speaking order. `role` is `hook`, `body` or `cta`; `emotion` is
  `neutral`, `excited`, `calm`, `serious`, `happy` or `disappointed`.

Answer with an id:

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

Troupe polls every 20 seconds at first, then less often (or at the server's
`poll_every_s`), for up to two hours by default (change it in the model's
settings). The project page also checks while it is open, every 4 seconds.

## Local renderer

`renderer/` voices the script and stages it, on the CPU, in seconds: a Kokoro
voice per actor, the actor card (the same colors and initials as the actor's
portrait in Troupe), word-by-word captions and a slowly moving background,
encoded as H.264 + AAC. There is no generated picture of a person: it is a
draft you can listen to, time and share, not a substitute for a video model.

The video is as long as the script, not the clip length picked at launch:
0.3 s of silence, each line as long as Kokoro takes to say it with 0.35 s
between lines, then 0.6 s. The clip length still caps the script, as for any
model.

### Run it

With Docker (the image is built from this checkout):

```bash
docker compose --profile renderer up -d --build
```

On a Mac or any machine with Node.js 22+ and ffmpeg:

```bash
pnpm install
pnpm renderer          # http://127.0.0.1:8078
```

On first start it downloads Kokoro-82M (`onnx-community/Kokoro-82M-v1.0-ONNX`,
8-bit, about 90 MB) from Hugging Face, into the `renderer` volume in Docker or
`~/.cache/troupe-renderer` otherwise. Later starts load it in under a second.

| Variable | Default | |
|---|---|---|
| `PORT`, `HOST` | `8078`, `127.0.0.1` (`0.0.0.0` in Docker) | where it listens |
| `TOKEN` | none | require `Authorization: Bearer <token>`; in Compose, set `TROUPE_RENDERER_TOKEN` in `.env` |
| `KOKORO_DTYPE` | `q8` | `fp32` (about 330 MB) sounds slightly cleaner; `q4` is smaller |
| `KOKORO_CACHE` | `~/.cache/troupe-renderer` | where the weights go |
| `OUT_DIR` | the OS temp folder | finished MP4s; they are not cleaned up |
| `TROUPE_RENDERER_PORT` | `8078` | Compose only: the port published on `127.0.0.1` |

### Add it to Troupe

**Settings → Local models → Add a local model → HTTP endpoint**:

| Field | Value |
|---|---|
| Address | `http://renderer:8078` when Troupe runs in the same Compose stack; `http://127.0.0.1:8078` under `pnpm dev`; `http://host.docker.internal:8078` for Troupe in Docker and `pnpm renderer` on the host |
| Formats | 9:16, 16:9, 1:1 |
| Resolutions | any (480p to 1080p); at 720p an 8 s clip takes under 4 s on an Apple M5 |
| Clip lengths | the lengths you want to allow, e.g. `4, 6, 8, 10, 15` |
| Audio | Always with audio (Audio on request also works: silent jobs skip the voice and time lines from the word count) |
| Frames per second | 24 (up to 60) |

Then **Test** and **Add model**. The renderer's `/health` asks for
`poll_every_s: 1`, which **Test** reports ("It asks Troupe to check on renders
every 1 s.") and **Add model** saves, so a clip shows up on the project page a
few seconds after the render ends. A renderer model added before this was
supported picks the pace up when you press **Test** on it in Settings.

### Limits

- Kokoro's voices are English (American and British). Lines in another
  language are read with English pronunciation; Troupe warns about the
  language when you launch only if the model declares its languages, which
  the add-model form does not ask for yet.
- The voice follows the actor's gender, and each actor keeps the same voice;
  emotions and the actor's voice profile ("fast", "measured", …) set the pace.
- Without `script` in the job (another client than Troupe), the renderer reads
  the dialogue back from the compiled prompt and draws a "Narrator" card.
