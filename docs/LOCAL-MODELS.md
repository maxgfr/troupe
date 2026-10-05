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

Troupe fills in the prompt, size, frame count, frame rate, seed and output
name. LTX-2 and Wan 2.2 come from ComfyUI's own templates
(comfyui-workflow-templates 0.11.76), exported with **Workflow → Export (API)**
from ComfyUI 0.38.0. LTX-Video 2B is Troupe's own graph of ComfyUI core nodes,
offered first because it is the one that fits a 16 GB Mac.

| | LTX-Video 2B distilled | LTX-2 | Wan 2.2 TI2V 5B |
|---|---|---|---|
| Audio | none: the actor mimes | generated with the video (voice and sound) | none: the actor mimes |
| Formats | 9:16, 16:9, 1:1 at 480p | 9:16, 16:9, 1:1 at 720p or 1080p | 9:16, 16:9 at 720p |
| Lengths | 2, 3, 4, 5 s at 24 fps | 4, 5, 6, 8, 10 s at 24 fps | 3, 4, 5 s at 24 fps |
| Memory | 16 GB Apple Silicon (rendered); an 8 GB GPU should do, not tried | plan on 24 GB of GPU memory | 8–12 GB of GPU memory |
| Model files | about 16 GB | about 42 GB | about 17 GB |
| Status | rendered end to end | validated by ComfyUI, not rendered | validated by ComfyUI, not rendered |

"Rendered end to end" (2026-10-05): ComfyUI 0.38.0 from source on an Apple M5
with 16 GB (PyTorch 2.14, MPS), added with `troupe models add comfyui
--template ltxv-2b-distilled`, launched from Troupe at 2 s, 480p, 9:16; Troupe
polled it, downloaded it and checked it with ffprobe: H.264, 480×832, 49
frames, 2.04 s, in about four minutes the first time (most of it loading the
text encoder) and under a minute of sampling. "Validated" means ComfyUI 0.38.0
accepted the filled-in workflow and only reported the missing model files.
LTX-2 plans on 24 GB of GPU memory, more than this 16 GB Mac has; Wan 2.2 was
not tried there, its 17 GB of model files being more than the disk had left.
Please report a full render either way.

Model files go under ComfyUI's `models/` folder. **Test** lists the ones missing
with their download links. Copy or hard-link them there: ComfyUI 0.38.0 did not
open a checkpoint symlinked to a file outside `models/`.

**LTX-Video 2B distilled** (`Lightricks/LTX-Video`, LTXV Open Weights License;
T5-XXL, Apache 2.0):

- `checkpoints/ltxv-2b-0.9.8-distilled.safetensors` (6.3 GB, includes the VAE)
- `text_encoders/t5xxl_fp16.safetensors` (9.5 GB), from
  `comfyanonymous/flux_text_encoders`. If the local renderer's AI video mode
  already downloaded `Lightricks/LTX-Video-0.9.5`, its `text_encoder` folder
  holds the same encoder in four fp32 shards; merging them into one fp16 file
  avoids a second download.

The checkpoint is the one the [AI video mode](#ai-video-mode-ltx-video) uses,
with the same license and revenue threshold ([License](#license)).

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
test pattern with ffmpeg) to start from. It is an example, not a service: its
MP4s pile up in the OS temp folder (`troupe-example-model`) and finished jobs
stay in memory until it stops, so restart it or empty that folder now and then.

All requests carry `Authorization: Bearer <token>` when a token is set.

### `GET /health`

```json
{ "ok": true, "contract": 1, "poll_every_s": 1 }
```

`poll_every_s` is optional: how often, in seconds, Troupe should ask about a
job. **Test** reads it, shows it, and **Add model** saves it with the model;
a model added without a test asks its server for it once, in the background,
right after it is added. Testing a saved model again picks up a new value,
and changing a model's server forgets it until the next test. Troupe rounds it to whole seconds
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
      "voice_profile": "warm and enthusiastic, mid-tempo",
      "portraits": {
        "front": "actors/lea-01/v1/front.webp",
        "happy": "actors/lea-01/v1/happy.webp",
        "calm": "actors/lea-01/v1/calm.webp",
        "excited": "actors/lea-01/v1/excited.webp",
        "profile-left": "actors/lea-01/v1/profile-left.webp",
        "profile-right": "actors/lea-01/v1/profile-right.webp"
      }
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
  the delivery in a few words. `portraits`, when the actor has pictures, maps
  each shot (`front`, `profile-left`, `profile-right`, `happy`, `calm`,
  `excited`) to its path in Troupe's cast, such as
  `actors/lea-01/v1/front.webp`. Troupe sends paths, never the pictures. A
  server can read them from its own copy of the cast (the file
  `public/actors/lea-01/v1/front.webp` in this repository,
  [ACTORS.md](ACTORS.md)), or download them from Troupe: append the path to
  Troupe's address (`https://troupe.example.com/actors/lea-01/v1/front.webp`).
  When Troupe sets `TROUPE_ACTOR_PORTRAITS_URL`, the pictures live there
  instead: drop the leading `actors/` and append the rest to that URL
  (`https://cdn.example.com/cast/lea-01/v1/front.webp`). The pictures are
  public files; no token is needed.
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
`progress` (0 to 1, optional) fills the bar under the render on the project
page while the job runs.

```json
{ "status": "succeeded", "video_url": "/files/job-123.mp4", "captions": "burned" }
```

`captions` is optional: `"burned"` says the video already shows the script's
captions in the picture, so Troupe's player keeps its own captions track off
(viewers can still turn it on). Leave it out when the video has no captions.

`video_url` may be relative, and must be on the same origin as the server:
Troupe refuses to follow it anywhere else and does not follow redirects. The
file must be an MP4 of at most 200 MB.

Troupe polls every 20 seconds at first, then less often (or at the server's
`poll_every_s`), for up to two hours by default (change it in the model's
settings). The project page also checks while it is open, every 4 seconds.

## Local renderer

`renderer/` voices the script and stages it, on the CPU, in seconds: a Kokoro
voice per actor, the actor card (the actor's portrait from Troupe's cast,
switching to their happy, calm or excited picture on lines with that emotion,
or their initials when they have no picture), word-by-word captions and a
slowly moving background, encoded as H.264 + AAC. Nobody moves or speaks on
screen: it is a draft you can listen to, time and share, not a substitute for
a video model.

The video is as long as the script, not the clip length picked at launch:
0.3 s of silence, each line as long as Kokoro takes to say it with 0.35 s
between lines, then 0.6 s. The clip length still caps the script, as for any
model: Troupe will not launch a script whose estimated length (2.5 words a
second) is over it, though the voice may run a little longer or shorter than
that estimate. The project page shows the video's real length once it is
saved.
The captions are drawn into the picture, so the player keeps its own captions
track off for these videos. Videos rendered before Troupe read the
`captions` field still turn it on: nothing stored says which HTTP model was
this renderer, so they were left as they were; switch the track off in the
player's menu.

### Run it

With Docker it runs by default: `docker compose up -d --wait` starts it as
the `renderer` service, and the studio adds it as a model on first start
([Add it to Troupe](#add-it-to-troupe)). It has no port on the host, so it
never clashes with `pnpm renderer`. For a studio started with `pnpm dev`,
publish it on `127.0.0.1` with the dev overlay:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --wait renderer   # http://127.0.0.1:8078
```

and add `http://127.0.0.1:8078` in Settings (or start `pnpm dev` with
`TROUPE_AUTOCONFIGURE=1 TROUPE_RENDERER_URL=http://127.0.0.1:8078`, which adds
it for you). `TROUPE_RENDERER_PORT` picks another port.

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
| `KOKORO_DTYPE` | `q8` | weights to run: `q8` (about 90 MB), `fp16` (165 MB), `q4f16` (155 MB), `q4` (305 MB) or `fp32` (330 MB, slightly cleaner) |
| `KOKORO_VOICES` | the built-in casting | the Kokoro voices actors are cast from, e.g. `female=af_heart,af_bella;male=am_michael`; both pools are required |
| `KOKORO_CACHE` | `~/.cache/troupe-renderer` | where the weights go |
| `OUT_DIR` | the OS temp folder | finished MP4s |
| `KEEP_RENDERS_HOURS` | `24` | how long a finished job and its MP4 are kept before the renderer forgets the job and deletes the file (Troupe downloads each video as soon as it is done); MP4s an earlier run left in `OUT_DIR` go once they are that old; `0` keeps everything |
| `PORTRAITS_DIR` | `public/actors` in this checkout | the actors' pictures, laid out as `<actor>/v1/front.webp` ([ACTORS.md](ACTORS.md)); a relative path is read from the repository root; a missing picture falls back to the front one, then to the initials, and a job's portrait path the renderer cannot use is logged and skipped |
| `TROUPE_RENDERER_PORT` | `8078` | Compose with `docker-compose.dev.yml` only: the port published on `127.0.0.1` |
| `TROUPE_RENDERER_KOKORO_DTYPE`, `TROUPE_RENDERER_KOKORO_VOICES` | as above | Compose only: passed on as `KOKORO_DTYPE` and `KOKORO_VOICES` |
| `TROUPE_RENDERER_PORTRAITS_DIR` | `./public/actors` | Compose only: the host folder mounted, read-only, as the container's pictures (relative to the repository root, where `docker-compose.yml` is) |

### Add it to Troupe

In the Docker stack there is nothing to do: on first start the studio adds
the `renderer` service as **Local renderer**, with the settings below, and
makes it the default model if none was chosen
([SELF-HOSTING.md](SELF-HOSTING.md#first-start-wiring)). Otherwise, or for
another renderer, **Settings → Local models → Add a local model → HTTP
endpoint**:

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
  language are read with English pronunciation (the renderer logs it when a
  job's `language` is not English); Troupe warns about the
  language when you launch only if the model declares its languages, which
  the add-model form does not ask for yet.
- The voice follows the actor's gender, and each actor keeps the same voice;
  emotions and the actor's voice profile ("fast", "measured", …) set the pace.
- Without `script` in the job (another client than Troupe), the renderer reads
  the dialogue back from the compiled prompt and draws a "Narrator" card with
  initials. That dialogue is cut to about one and a half times `duration_s`
  (timed at 2.5 words a second), and the renderer logs what it left out.
- A line too long for the caption area even at the smallest caption size is
  shown a few rows at a time, following the word being said.

## AI video mode (LTX-Video)

The local renderer has an opt-in second mode that puts a generated person
behind the captions: [LTX-Video](https://huggingface.co/Lightricks/LTX-Video)
2B draws a short clip of someone talking to the camera, and the renderer lays
the same Kokoro voice and karaoke captions over it. It is off unless you start
it, and nothing (Python, PyTorch, weights) is installed or downloaded before
you do.

For each job the renderer:

1. voices the lines with Kokoro, like the fast mode;
2. runs `renderer/ltx/generate.py` (diffusers' `LTXConditionPipeline`) in its
   own Python environment, managed by [uv](https://docs.astral.sh/uv/), to
   generate a silent clip: 480×832 for 9:16 (832×480 for 16:9, 640×640 for
   1:1), 121 frames, about 5 s at 24 fps;
3. repeats that clip forwards then backwards until the script is said,
   upscales it to the size Troupe asked for (Lanczos) and lays the captions
   over it on a soft shade, without the actor card;
4. muxes the voice: H.264 + AAC, as long as the script.

The picture comes from a text prompt built from the actor's gender and age
range (`LTX_PROMPT`). The model does not know what is said: lips do not
follow the voice, and the person changes from one render to the next.

### Where it runs

| Machine | Device | Status |
|---|---|---|
| Mac with Apple Silicon, 16 GB or more | `mps` (the GPU, through PyTorch's Metal backend) | rendered end to end on an M5 with 16 GB (below) |
| Linux or Windows with an NVIDIA GPU | `cuda` | should work (the same diffusers code), not tried |
| Anything else | `cpu` | works in principle, far too slow to be useful |

On a Mac it runs natively, not in Docker: containers on macOS have no access
to the Apple GPU (Docker's Linux virtual machine has no Metal). Troupe itself
can still run in Docker and use a renderer started on the host
(`http://host.docker.internal:8078/ltx`). On Linux with an NVIDIA GPU it also
runs in Docker ([below](#in-docker)). The `renderer` service's image has no
Python or PyTorch in it.

### In Docker

The `ltx` Compose profile builds the renderer's `ltx` image from this
checkout (Debian's Python 3.11, uv and the environment locked in
`renderer/ltx/uv.lock`: PyTorch's Linux build, which carries NVIDIA's CUDA
libraries on amd64 and arm64 alike; the image built on an Apple Silicon Mac
weighs 10 GB) and runs it as `renderer-ltx` on the NVIDIA GPU (the
[NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/)
must be installed). The image is not published: you build it, and accept the
weights' license when they download. Download the weights first (about
25 GB, into the `renderer-ltx` volume), then start it:

```bash
docker compose --profile ltx build renderer-ltx
docker compose --profile ltx run --rm renderer-ltx /app/renderer/ltx/.venv/bin/python /app/renderer/ltx/generate.py --download
docker compose --profile ltx up -d --wait
```

and add the model `http://renderer-ltx:8078/ltx` as below (the fast mode
answers at `http://renderer-ltx:8078` too). The `LTX_*` settings in `.env`
are passed on. `--profile ltx-cpu` runs the same image as `renderer-ltx-cpu`
without a GPU (`LTX_DEVICE=cpu`, float32): it works, but a clip takes minutes
to hours; it is there for trying the pipeline, not for use. On an Apple Silicon Mac
the image built in 19 minutes and `renderer-ltx-cpu` started healthy, with
`/ltx/health` ready (PyTorch 2.14.1, diffusers 0.40.0); no clip was generated
there, and it has not been run on an NVIDIA GPU.

### Set it up

You need Node.js 22+, ffmpeg and uv (`brew install uv` on a Mac). Then, once:

```bash
pnpm install
pnpm renderer:ltx:setup
```

This creates `renderer/ltx/.venv` (PyTorch, diffusers, transformers: about
800 MB on a Mac, several GB with CUDA on Linux) and downloads the weights into
the Hugging Face cache (`~/.cache/huggingface/hub`, or `$HF_HOME/hub`):

| File | Size | From |
|---|---|---|
| `ltxv-2b-0.9.8-distilled.safetensors` (transformer and VAE) | 6.3 GB | [`Lightricks/LTX-Video`](https://huggingface.co/Lightricks/LTX-Video) |
| T5 v1.1 XXL text encoder (stored in fp32) and tokenizer | 19 GB | [`Lightricks/LTX-Video-0.9.5`](https://huggingface.co/Lightricks/LTX-Video-0.9.5) |
| scheduler and model configs | a few kB | `Lightricks/LTX-Video-0.9.5` |

Run the setup before the first job. Until the Python environment exists,
**Test** on the `/ltx` model fails with "The AI video mode's Python
environment is not set up yet. Run pnpm renderer:ltx:setup …" (and with "needs
"uv", which is not installed here" without uv). A job sent anyway would have
to install PyTorch and download about 25 GB first, which on an ordinary
connection takes longer than `LTX_TIMEOUT_S` (30 minutes) and would be
stopped.

### Run it

```bash
pnpm renderer:ltx       # http://127.0.0.1:8078 and http://127.0.0.1:8078/ltx
```

(or `LTX_ENABLED=1 pnpm renderer`). The fast mode keeps answering at the
root; the AI video mode answers the same contract v1 routes under `/ltx`, so
Troupe sees two models. Jobs from both run one at a time. A renderer started
without the mode answers `/ltx` with HTTP 503 and a message saying how to turn
it on, which **Test** shows.

Each generation runs as its own process group. A timeout, the end of the job
and stopping the renderer (Ctrl-C, `SIGTERM`) stop the whole group, Python
included, so no generation is left holding the GPU's memory.

### Add it to Troupe

**Settings → Local models → Add a local model → HTTP endpoint**, as for the
fast mode, with:

| Field | Value |
|---|---|
| Address | `http://127.0.0.1:8078/ltx` under `pnpm dev`; `http://host.docker.internal:8078/ltx` for Troupe in Docker and the renderer on the host; `http://renderer-ltx:8078/ltx` with the `ltx` profile |
| Formats | 9:16, 16:9, 1:1 |
| Resolutions | 480p or 720p (the clip is generated at about 480×832 and upscaled) |
| Clip lengths | e.g. `4, 6, 8, 10` |
| Audio | Always with audio |
| Frames per second | 24 |

**Test** reports "It asks Troupe to check on renders every 5 s.".

### Settings

All optional; the defaults are the ones measured below.

| Variable | Default | |
|---|---|---|
| `LTX_ENABLED` | off | `1` turns the mode on (what `pnpm renderer:ltx` does with `--ltx`) |
| `LTX_RESOLUTION` | `480x832` | the generated clip for 9:16, width x height in multiples of 32; other formats keep about the same number of pixels |
| `LTX_FRAMES` | `121` | frames generated, a multiple of 8 plus 1 (`97` is 4 s, `145` is 6 s at 24 fps) |
| `LTX_FPS` | `24` | the frame rate the model generates for |
| `LTX_SEED` | a new one per render | a fixed seed, for repeatable clips |
| `LTX_PROMPT` | a selfie-style review in a bright living room | the picture prompt; `{person}` ("woman aged 25 to 34"), `{gender}`, `{age}`, `{name}`, `{voice_profile}` and `{orientation}` (vertical, horizontal, square) are filled in |
| `LTX_NEGATIVE_PROMPT` | blur, distortion, text, watermarks | only used when `LTX_GUIDANCE` is above 1 |
| `LTX_UPSCALE` | `lanczos` | ffmpeg's scaler to the requested size: `lanczos`, `bicubic`, `bilinear`, `spline` or `neighbor` |
| `LTX_LOOP` | `pingpong` | how a clip shorter than the script fills it: `pingpong` (forwards, then backwards) or `loop` (from the start again, with a visible jump) |
| `LTX_TIMEOUT_S` | `1800` | a generation that takes longer is stopped |
| `LTX_COMMAND` | `uv run --project renderer/ltx python renderer/ltx/generate.py` | the program that runs the script, split on spaces, e.g. `/opt/ltx/.venv/bin/python /opt/troupe/renderer/ltx/generate.py` |
| `LTX_MODEL` | the 0.9.8 2B distilled checkpoint above | transformer and VAE: a `.safetensors` file (Hugging Face URL or local path) or a diffusers repo |
| `LTX_BASE_MODEL` | `Lightricks/LTX-Video-0.9.5` | the diffusers repo the configs, tokenizer, text encoder and scheduler come from |
| `LTX_TEXT_ENCODER` | the base model's | another T5 v1.1 XXL encoder repo, e.g. a bfloat16 copy to halve the 19 GB download |
| `LTX_DEVICE` | the best available: `cuda`, `mps`, then `cpu` | where the model runs |
| `LTX_TEXT_ENCODER_DEVICE` | `LTX_DEVICE` | where T5 runs; `cpu` leaves the GPU's memory to the video model |
| `LTX_DTYPE` | `bfloat16` | `bfloat16`, `float16` or `float32` |
| `LTX_TIMESTEPS` | `1000,993,987,981,975,909,725,0.03` | the distilled model's 8-step schedule; empty to use `LTX_STEPS` evenly spaced steps instead (for a non-distilled `LTX_MODEL`) |
| `LTX_STEPS` | the schedule's length (`8`); `40` when `LTX_TIMESTEPS` is empty | denoising steps |
| `LTX_GUIDANCE` | `1` | classifier-free guidance; the distilled model needs `1`, others about `3` |
| `LTX_VAE_TILING` | `1` | decode the video in tiles, across the frame and across time, which keeps the decoder's memory down |
| `LTX_VAE_TILE_FRAMES` | `16` | frames decoded together, a multiple of 8: `32` decoded the default clip in about 25 % less time on the M5, but free memory fell to 4 % |
| `LTX_PROMPT_CACHE` | `~/.cache/troupe-renderer/ltx-prompts` | where encoded prompts are kept (a few MB each), so the 9.5 GB text encoder only loads for a new prompt; empty turns it off |

### Measured on an Apple M5 with 16 GB

Apple M5, 16 GB of unified memory, macOS; PyTorch 2.14.1, diffusers 0.40.0,
Python 3.13; default settings (480×832, 121 frames at 24 fps, the 8-step
distilled schedule, guidance 1, bfloat16 on `mps`, tiled decoding).

| Run | Wall time | Peak memory | Notes |
|---|---|---|---|
| Through Troupe, first render for this actor (2-line script, 9:16, 720p) | 128.6 s for the clip, 132.7 s for the job; the video appeared on the project page 137 s after **Launch draft** | 8.1 GB max RSS for the Python process; the system's free memory bottomed at 18 % | about 40 s of it loads T5 and encodes the prompt |
| Through Troupe again, same actor (prompt already encoded) | 90.9 s for the clip, 94.7 s for the job, on the page after 98 s | 2.2 GB max RSS; free memory touched 1 % for a few seconds while the checkpoint loaded and swap grew from 3.7 GB to 14 GB, with the browser, `pnpm dev` and other apps open | the Mac stayed usable, but slow while it swapped |
| `generate.py` alone, prompt already encoded | 82.3 s (`/usr/bin/time -l`) | 2.5 GB max RSS; free memory bottomed at 15 %, swap unchanged | loading 6 s, 8 denoising steps 3 s, decoding 121 frames about 70 s |
| `generate.py` alone, `384x672` and 97 frames (4 s), prompt already encoded | 43.1 s | 1.4 GB max RSS; free memory bottomed at 18 % | the lighter setting |
| `generate.py` alone, decoding all frames at once (tiled across the frame only) | 98.8 s | 5.6 GB max RSS; free memory fell to 1 % and swap grew from 6 GB to 16 GB while decoding | why decoding is now also tiled across time |

Max RSS undercounts what the GPU holds (Metal buffers live in the same
memory), so the system-wide free memory reported by `memory_pressure` is the
better guide. With the defaults a render fits in 16 GB, but only just:
loading the single-file checkpoint briefly holds it twice, decoding fills
most of the rest, and macOS swaps whatever else is open. Close browsers and
other large apps before a render; `LTX_FRAMES=97` and a smaller
`LTX_RESOLUTION` (such as `384x672`) leave more room.

The result: a 6.35 s H.264 + AAC MP4 at 720×1280, the 5 s clip played
forwards then backwards under the captions. Looking at the frames, the clip
is convincing at phone size: a photoreal woman in a bright room, the same
face through the clip, natural head movement and blinking, her mouth moving
as if she were talking (not in sync with the voice). Upscaled from 480×832
it is soft, the framing is sometimes off-centre, and the turn of the
forwards-backwards loop shows as a brief reversal of motion. Captions read
on the shade over a light shirt.

### Limits

- It is slow and heavy: minutes per clip, most of the machine's memory, and
  the fans. Close other large apps first.
- About 5 seconds of picture, repeated: a 10 s script shows the clip forwards
  then backwards. Longer clips (`LTX_FRAMES`) need more memory and time.
- Generated at 480×832 and upscaled: soft at 720p, blurry at 1080p.
- No lip sync, no consistent face from one render to the next, hands and
  faces sometimes distorted: a mood shot to put captions on, not an actor.
- English prompts only; the voice is Kokoro's, as in the fast mode.

### License

The renderer's code is MIT, like Troupe. The weights are not: the default
checkpoint (LTX-Video 2B 0.9.8 distilled) is under the
[LTXV Open Weights License 0.X](https://huggingface.co/Lightricks/LTX-Video/blob/main/LTX-Video-Open-Weights-License-0.X.txt),
which you accept by downloading it. In short, and read the license itself:

- Free to use, modify and redistribute for any purpose, but **entities with
  annual revenues of at least $10,000,000** need a paid commercial license
  from Lightricks.
- **Use restrictions** (Attachment A) bind every user and must be passed on
  to anyone you share the model with. Among them: no use that breaks the law,
  harms minors, defames or harasses, no impersonating people without their
  consent (deepfakes), and no publishing generated content **without
  expressly and intelligibly disclaiming that it is machine generated**.
  Troupe's export presets say how each platform wants AI content disclosed;
  follow them.
- Lightricks may restrict use that breaks the license and asks you to use the
  latest version.

The T5 v1.1 XXL text encoder is Google's, under the Apache License 2.0.

### The more permissive 0.9.5 checkpoint

LTX-Video 2B 0.9.5 is under Lightricks'
[OpenRAIL-M license](https://huggingface.co/Lightricks/LTX-Video/blob/main/ltx-video-2b-v0.9.5.license.txt)
(March 5, 2025): it allows commercial use with no revenue threshold, under
much the same use restrictions (the machine-generated disclaimer and the
deepfake ban included). It is not distilled, so it needs about 40 steps with
guidance:

```bash
export LTX_MODEL=Lightricks/LTX-Video-0.9.5 LTX_TIMESTEPS= LTX_GUIDANCE=3
pnpm renderer:ltx:setup   # adds its transformer and VAE (6.3 GB) to the cache
pnpm renderer:ltx
```

On the M5 it rendered the default clip in 358 s (5.7 GB max RSS, free memory
down to 14 %), against about 90 s for the distilled default. Its picture was
smoother and more airbrushed, and in that run the framing cut the face in half.
