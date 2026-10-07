# Customizing Troupe

Every setting a self-hoster or a fork can change, in one place: what it does,
its default and where it is read. Nothing here is required; the defaults run
the whole product. `pnpm test` checks this page against the code that reads
each variable (`src/customizing.test.ts`), so a setting cannot be added,
renamed or removed without its line here.

Settings live in six places:

| Where | What it configures | How to set it |
|---|---|---|
| The studio's environment | the self-hosted server: access, keys, the script chat, the library, the first-start wiring | `.env` next to `docker-compose.yml`, or the environment of `pnpm dev` / `pnpm start`; `src/env.js` checks each value at start |
| Settings, in the studio | models, the default model, provider keys, the script chat | the Settings page (`g` then `s`); saved in the database and stronger than the environment |
| The Docker stack | ports, images, memory, which models the stack downloads | `.env` next to `docker-compose.yml` ([.env.example](../.env.example)) |
| The local renderer's environment | voices, the video's look, the AI video mode, transcription | its shell for `pnpm renderer`, or `TROUPE_RENDERER_*` in `.env` for the stack |
| The browser edition's build | its renderer, chat model, library models, base path, links | `site/.env` or exported `VITE_*` variables when it is built ([site/.env.example](../site/.env.example)); a bad value stops the build |
| The CLI's environment | which studio, profile and project | the shell `troupe` runs in |

## Common changes

### Models

- **Add a model on your own GPU or server.** Settings › Local models › Add:
  ComfyUI (a bundled workflow or your own API export) or any server that
  speaks the [HTTP contract](LOCAL-MODELS.md#http-endpoint). The CLI does the
  same: `troupe models add http|comfyui`.
- **Remove one.** Settings › Local models › Archive (its renders stay), or
  `troupe models remove`. Turn a cloud model off in Settings › Cloud models.
- **Defaults, prices and limits.** Each model's card in Settings sets its
  default format, length and resolution, a price per second for estimates and
  a time limit. Settings › Default model picks what new launches use.
- **A newer upstream id for a built-in cloud model**, without waiting for a
  release: `TROUPE_MODEL_IDS`.
- **A new cloud provider** is code: an adapter in
  `src/modules/generation/server/adapters/` and its catalog entry in
  `src/modules/models/builtins.ts` ([CONTRIBUTING.md](../CONTRIBUTING.md)).
- **The stack's renderer as a model** is added once, on first start
  ([SELF-HOSTING.md](SELF-HOSTING.md#first-start-wiring)): its name, address,
  token and lengths come from `TROUPE_RENDERER_*`; `TROUPE_AUTOCONFIGURE=0`
  skips it.
- **The browser edition's model** is its in-browser renderer, configured when
  the site is built (`VITE_KOKORO_*`, `VITE_RENDER_*`); a page served from the
  web cannot reach servers on your network.

### Voices

The actors are cast from two pools of Kokoro voices, one per gender:
`KOKORO_VOICES` for the local renderer (`TROUPE_RENDERER_KOKORO_VOICES` in the
stack) and `VITE_KOKORO_VOICES` for the browser edition. Set both to the same
value to keep the two editions alike, for instance
`female=af_heart,bf_emma;male=am_michael,bm_george`. A library actor keeps the
voice the catalog gives them while the pools hold it; one whose voice the pools
leave out gets another, and no longer sounds like their sample
([ACTORS.md](ACTORS.md#voice-samples)). `KOKORO_DTYPE` and
`VITE_KOKORO_DTYPE_*` trade download size against quality.

### The video scene

The local renderer and the browser edition draw the same actor card and
captions (`src/modules/scene`). Each actor gets a palette from their own hue,
and the text is set in Geist.

- **One hue for everyone**, e.g. your brand's: `SCENE_HUE=210` (0 to 359) for
  the renderer, `TROUPE_RENDERER_SCENE_HUE` in the stack, `VITE_SCENE_HUE` for
  the browser edition (in the stack, a build argument of `web`:
  `VITE_SCENE_HUE=210 docker compose up -d --build web`). The studio's own
  pages keep each actor's hue.
- **Another font**: `SCENE_FONT_FILE` is a `.woff2`, `.woff`, `.ttf` or
  `.otf` file the renderer reads; a variable font covers every weight drawn
  (500 to 700), a static file is used for all of them. In the stack the file
  must be inside the container, so mount it with a
  `docker-compose.override.yml` next to `docker-compose.yml`:

  ```yaml
  services:
    renderer:
      volumes:
        - ./brand/Inter.woff2:/fonts/Inter.woff2:ro
      environment:
        SCENE_FONT_FILE: /fonts/Inter.woff2
  ```

  For the browser edition, put the file in `site/public/fonts/` and build with
  `VITE_SCENE_FONT_URL=fonts/Inter.woff2` (a path under the site's base), or
  give an `https://` URL that allows cross-origin requests; the stack's `web`
  service takes it as a build argument too.
- **The actors' pictures**: see [ACTORS.md](ACTORS.md#replacing-the-cast)
  (`PORTRAITS_DIR`, `TROUPE_RENDERER_PORTRAITS_DIR`, `VITE_PORTRAITS_DIR`,
  `TROUPE_ACTOR_PORTRAITS_URL`).

### The AI video mode

`LTX_*` set the generated clip's size (`LTX_RESOLUTION`), length
(`LTX_FRAMES` at `LTX_FPS`), steps (`LTX_TIMESTEPS` or `LTX_STEPS`), guidance,
prompt and weights. [LOCAL-MODELS.md](LOCAL-MODELS.md#settings) explains each
one with measurements; the weights' licenses are in
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

### The script chat

- **Provider**: Ollama by default, Claude once an Anthropic key is set
  (`TROUPE_CHAT_PROVIDER` forces one), WebLLM in the browser edition.
- **Model**: `OLLAMA_MODEL`, `ANTHROPIC_MODEL`, `VITE_WEBLLM_MODEL`.
- **Address**: `OLLAMA_URL`, and `ANTHROPIC_BASE_URL` for a gateway or proxy
  in front of Anthropic's API.
- **House style** (what every request is told about tone, words to avoid and
  sign-offs): `TROUPE_CHAT_INSTRUCTIONS`, `VITE_CHAT_INSTRUCTIONS`, or
  Settings › Script chat, which wins.

[SCRIPT-CHAT.md](SCRIPT-CHAT.md) explains how answers are made.

### Branding and theme

- **Colors, type, radii and spacing** are CSS variables (`--troupe-*`) in
  `src/styles/design-tokens.css`, mirrored in `src/styles/design-tokens.json`
  for tools; `src/styles/tokens.test.ts` keeps the two in step. Both editions
  and the landing page read them. [DESIGN.md](../DESIGN.md) explains the
  system, the accent (`--troupe-color-primary`) included.
- **The name** is `APP_NAME` in `src/app/_components/page-title.ts` (every
  screen's title), the metadata in `src/app/layout.tsx` and
  `site/app/index.html`, the wordmark in `src/app/_components/wordmark.tsx`,
  and the landing page, `site/index.html`. A fork that renames the product
  changes these files; there is no variable for it, since the wordmark is
  drawn.
- **Where the browser edition is served**: `VITE_BASE` (`/troupe/`, or `/`
  for a domain of its own; `TROUPE_WEB_BASE` in the stack), and
  `VITE_SITE_URL` and `VITE_REPO_URL` for the landing page's canonical, social
  preview and source links.

## Reference

### The studio

Read by the self-hosted server (`src/env.js`). In the Docker stack, set them
in `.env`: `docker-compose.yml` passes each one on to the `app` service.

| Variable | Default | What it does |
|---|---|---|
| `DATABASE_URL` | built for the stack's `db` | PostgreSQL connection string; required outside Docker. On Supabase, the session pooler. |
| `TROUPE_ACCESS_CODE` | generated on first start | The code that opens the studio, at least 12 characters ([SECURITY.md](../SECURITY.md)). |
| `TROUPE_TRUSTED_PROXIES` | `0` | Proxies of your own behind the one facing the internet (0 to 10). Wrong access codes are counted per address, 5 per 15 minutes, read from X-Forwarded-For's last hop, or this many hops further left; 100 wrong codes from all addresses together stop sign-in for the rest of the window too. |
| `TROUPE_SECRET` | generated (`secret.key` in the data folder) | Encrypts saved keys and tokens; back it up with the database. |
| `TROUPE_DATA_DIR` | `./data` (`/app/data` in the image) | Videos, `access-code` and `secret.key`. |
| `TROUPE_AUTO_MIGRATE` | `1` | Applies database migrations when the server starts; `0` leaves them to `pnpm db:migrate`. Never on Vercel. |
| `TROUPE_INPROCESS_WORKER` | `1` in the image, off otherwise | Checks running renders from the server process every 30 seconds. |
| `TROUPE_ACTOR_PORTRAITS_URL` | `/actors` | Where browsers load the actors' pictures: a path or URL laid out like `public/actors`. |
| `FFPROBE_PATH` | `ffprobe` on the PATH | The ffprobe that checks every video before it is kept (also read by `troupe doctor --live`). |
| `FFMPEG_PATH` | `ffmpeg` | The ffmpeg the library uses for sound and pictures. |
| `GOOGLE_GENAI_API_KEY` | none | Google AI key for Veo; a key saved in Settings wins. |
| `GEMINI_API_KEY` | none | The same, read when `GOOGLE_GENAI_API_KEY` is empty. |
| `GOOGLE_API_KEY` | none | The same, read when both above are empty. |
| `FAL_KEY` | none | fal.ai key for Kling and Seedance; a key saved in Settings wins. |
| `TROUPE_MODEL_IDS` | none | Newer upstream ids for built-in models, `key=id` pairs separated by commas. |
| `TROUPE_AUTOCONFIGURE` | `1` in Compose, off otherwise | First start: add the stack's renderer as a model and make it the default, once. |
| `TROUPE_RENDERER_URL` | `http://renderer:8078` | The renderer the first start adds. |
| `TROUPE_RENDERER_LABEL` | `Local renderer` | Its name in the studio. |
| `TROUPE_RENDERER_DURATIONS` | `4,6,8,10,15` | The clip lengths it offers, in seconds (1 to 60). |
| `TROUPE_RENDERER_TOKEN` | none | A token the renderer requires; saved, encrypted, with the model. The stack's renderer reads it too. |
| `TROUPE_CHAT_PROVIDER` | `auto` | `auto`, `ollama` or `anthropic`. |
| `OLLAMA_URL` | `http://127.0.0.1:11434` (Compose: `http://ollama:11434`) | The Ollama the chat (and the library) talk to. |
| `OLLAMA_MODEL` | `qwen3:4b` | The chat's Ollama model; the stack's `ollama` service downloads it. |
| `ANTHROPIC_API_KEY` | none | Claude for the chat; a key saved in Settings wins. |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | The Claude model. |
| `ANTHROPIC_BASE_URL` | Anthropic's API | Another address that speaks Anthropic's API: a gateway or proxy. |
| `TROUPE_CHAT_INSTRUCTIONS` | none | The house style, added to every request (2000 characters at most). |
| `TROUPE_CHAT_WORDS_PER_SECOND` | `2.5` | The word budget: clip seconds × this rate (1 to 5). |
| `TROUPE_CHAT_TIMEOUT_S` | `180` | How long one answer may take (10 to 1800). |
| `TROUPE_CHAT_SEND_TIMEOUT_S` | `300` | How long one request may take in all, its retry included (30 to 3600). |
| `TROUPE_CHAT_TEMPERATURE` | Ollama `0.4`, Claude its own | Sampling temperature, 0 to 2. |
| `TROUPE_CHAT_HISTORY_TURNS` | `6` | Earlier turns sent with each request (0 to 20). |
| `TROUPE_CHAT_ANTHROPIC_FALLBACK` | `auto` | Anthropic's server-side fallback: `auto`, `on` or `off` ([SCRIPT-CHAT.md](SCRIPT-CHAT.md#settings)). |
| `TROUPE_LIBRARY` | `1` | `0` turns the inspiration library off. |
| `TROUPE_LIBRARY_EMBED_MODEL` | `qwen3-embedding:0.6b` | Ollama model for search by meaning; `off` keeps keyword search. |
| `TROUPE_LIBRARY_VISION_MODEL` | `qwen3-vl:2b-instruct` | Ollama model that describes pictures; `off` skips the step. |
| `TROUPE_LIBRARY_OLLAMA_URL` | `OLLAMA_URL` | Another Ollama for those two. |
| `TROUPE_LIBRARY_OLLAMA_TIMEOUT_S` | `300` | Per request to it. |
| `TROUPE_TRANSCRIBE_URL` | none (Compose: `http://renderer:8078`) | The renderer that transcribes; unset, videos are not transcribed. |
| `TROUPE_TRANSCRIBE_TOKEN` | `TROUPE_RENDERER_TOKEN` | Its token. |
| `TROUPE_TRANSCRIBE_TIMEOUT_S` | `1800` | Per file. |
| `TROUPE_LIBRARY_MAX_UPLOAD_MB` | `500` | The largest upload or download. |
| `TROUPE_LIBRARY_MAX_DURATION_S` | `3600` | The longest video yt-dlp downloads. |
| `TROUPE_LIBRARY_FRAMES` | `12` | Pictures taken from a video. |
| `TROUPE_LIBRARY_VISION_FRAMES` | `6` | Of those, how many the vision model reads. |
| `TROUPE_LIBRARY_FETCH_TIMEOUT_S` | `60` | Fetching a page. |
| `TROUPE_LIBRARY_IDEAS` | `10` | How many ideas "ideas in this style" writes (1 to 10). |
| `TROUPE_LIBRARY_WRITE_TIMEOUT_S` | `300` | The longest one writing request may take in all. |
| `TROUPE_LIBRARY_ALLOW_PRIVATE_URLS` | `0` | `1` also fetches links to this machine and your network. |
| `TROUPE_YTDLP_PATH` | `yt-dlp` | The yt-dlp program; `off` turns video links off. |
| `TROUPE_YTDLP_PROXY` | none | A proxy for yt-dlp's requests ([LIBRARY.md](LIBRARY.md#security)). |
| `SUPABASE_URL` | none | Vercel + Supabase: the project's URL ([VERCEL-SUPABASE.md](VERCEL-SUPABASE.md)). |
| `SUPABASE_SERVICE_ROLE_KEY` | none | Vercel + Supabase: the service role key for Storage. |
| `SUPABASE_STORAGE_BUCKET` | `troupe-media` | Vercel + Supabase: the bucket videos go to. |
| `RECONCILE_SECRET` | none | Guards `/api/jobs/reconcile`, which a scheduler calls on Vercel; unset, it refuses every call. |

### The Docker stack

Read by `docker-compose.yml` (and `docker-compose.gpu.yml`,
`docker-compose.dev.yml`) from `.env`. [SELF-HOSTING.md](SELF-HOSTING.md#configuration)
has the details.

| Variable | Default | What it does |
|---|---|---|
| `POSTGRES_PASSWORD` | generated on first start | The database password; set it only for a database created with your own. |
| `TROUPE_BIND` | `127.0.0.1` | The address the studio and the browser edition listen on. |
| `TROUPE_PORT` | `3100` | The studio's port on the host. |
| `TROUPE_WEB_PORT` | `3101` | The browser edition's port on the host. |
| `TROUPE_WEB_BASE` | `/troupe/` | The path the browser edition is served under; written into its files, so rebuild `web` after changing it. |
| `TROUPE_VERSION` | `latest` | The image tag every service runs, e.g. `0.2.0`. |
| `TROUPE_APP_MEMORY` | `2g` | Memory limit of the studio. |
| `TROUPE_DB_MEMORY` | `1g` | Memory limit of PostgreSQL. |
| `TROUPE_RENDERER_MEMORY` | `2g` | Memory limit of the renderer. |
| `TROUPE_OLLAMA_MEMORY` | `8g` | Memory limit of Ollama. |
| `TROUPE_WEB_MEMORY` | `128m` | Memory limit of nginx. |
| `TROUPE_OLLAMA_MODELS` | `OLLAMA_MODEL` | Every model the `ollama` service downloads and waits for, separated by commas. |
| `OLLAMA_KEEP_ALIVE` | `30m` | How long Ollama keeps a model loaded after an answer. |
| `TROUPE_RENDERER_PORT` | `8078` | With `docker-compose.dev.yml` only: the renderer's port on `127.0.0.1`, for a studio run with `pnpm dev`. |
| `TROUPE_RENDERER_KOKORO_DTYPE` | `q8` | Passed to the renderer as `KOKORO_DTYPE`. |
| `TROUPE_RENDERER_KOKORO_VOICES` | the built-in casting | Passed to the renderer as `KOKORO_VOICES`. |
| `TROUPE_RENDERER_PORTRAITS_DIR` | `./public/actors` | The host folder mounted, read-only, as the renderer's actors' pictures. |
| `TROUPE_RENDERER_SCENE_HUE` | each actor's own | Passed to the renderer as `SCENE_HUE`. |
| `TROUPE_RENDERER_SCENE_FONT_FILE` | Geist | Passed to the renderer as `SCENE_FONT_FILE`: a path inside the container. |
| `TROUPE_RENDERER_KEEP_RENDERS_HOURS` | `24` | Passed to the renderer as `KEEP_RENDERS_HOURS`. |
| `TROUPE_TRANSCRIPTION` | `1` | The renderer's transcription (`WHISPER_ENABLED`). |
| `TROUPE_WHISPER_MODEL` | `base` | Passed as `WHISPER_MODEL`. |
| `TROUPE_WHISPER_COMPUTE_TYPE` | `int8` | Passed as `WHISPER_COMPUTE_TYPE`. |
| `TROUPE_WHISPER_LANGUAGE` | detected | Passed as `WHISPER_LANGUAGE`. |
| `TROUPE_WHISPER_THREADS` | `0` (its default) | Passed as `WHISPER_THREADS`. |
| `COMFYUI_IMAGE` | `yanwk/comfyui-boot:cu128-slim` | The image of the `comfyui` profile. |
| `TROUPE_CLI_DIR` | `.` | Where files the `cli` service downloads land. |

### The local renderer

Read by `renderer/` (`pnpm renderer`, the `renderer` and `renderer-ltx`
services). [LOCAL-MODELS.md](LOCAL-MODELS.md#local-renderer) describes it.

| Variable | Default | What it does |
|---|---|---|
| `HOST` | `127.0.0.1` (`0.0.0.0` in the image) | The address it listens on. |
| `PORT` | `8078` | Its port; `0` picks a free one. |
| `TOKEN` | none | Requires `Authorization: Bearer <token>`. |
| `KOKORO_DTYPE` | `q8` | Kokoro weights: `q8`, `fp16`, `q4f16`, `q4` or `fp32`. |
| `KOKORO_VOICES` | the built-in casting | The voices actors are cast from, `female=…;male=…`. |
| `KOKORO_CACHE` | `~/.cache/troupe-renderer` (`/data/kokoro` in the image) | Where the weights go. |
| `SCENE_HUE` | each actor's own | One hue, 0 to 359, for every actor's card and captions. |
| `SCENE_FONT_FILE` | Geist | A font file drawn instead. |
| `PORTRAITS_DIR` | `public/actors` | The actors' pictures ([ACTORS.md](ACTORS.md)). |
| `OUT_DIR` | the system's temp folder (`/data/renders` in the image) | Where finished MP4s wait for the studio. |
| `KEEP_RENDERS_HOURS` | `24` | How long a finished job and its MP4 are kept; `0` keeps them. |
| `FFMPEG` | `ffmpeg` on the PATH | The ffmpeg that encodes. |
| `WHISPER_ENABLED` | off (`1` in the image) | Transcription for the library, at `/transcribe`. |
| `WHISPER_MODEL` | `base` | faster-whisper size: `tiny`, `base`, `small`, `medium`, `large-v3`, `turbo`. |
| `WHISPER_COMPUTE_TYPE` | `int8` | `int8`, `int8_float16`, `float16` or `float32`. |
| `WHISPER_DEVICE` | `cpu` | `cpu`, `cuda` or `auto`. |
| `WHISPER_LANGUAGE` | detected | A language code (`en`, `fr`…) to skip detection. |
| `WHISPER_THREADS` | `0` | CPU threads; `0` lets faster-whisper choose. |
| `WHISPER_TIMEOUT_S` | `1800` | The longest transcription. |
| `WHISPER_MAX_MB` | `300` | The largest sound file it accepts. |
| `WHISPER_COMMAND` | `uv run` in `renderer/whisper` | The program that runs `transcribe.py`. |
| `LTX_ENABLED` | off | The AI video mode, at `/ltx` (`pnpm renderer:ltx`). |
| `LTX_RESOLUTION` | `480x832` | The generated clip for 9:16, multiples of 32. |
| `LTX_FRAMES` | `121` | Frames generated, a multiple of 8 plus 1. |
| `LTX_FPS` | `24` | The frame rate generated for. |
| `LTX_SEED` | a new one per render | A fixed seed, for repeatable clips. |
| `LTX_PROMPT` | a selfie-style review | The picture prompt, with `{person}`, `{gender}`, `{age}`, `{name}`, `{voice_profile}`, `{orientation}`. |
| `LTX_NEGATIVE_PROMPT` | blur, distortion, text | Used only when `LTX_GUIDANCE` is above 1. |
| `LTX_UPSCALE` | `lanczos` | ffmpeg's scaler to the requested size. |
| `LTX_LOOP` | `pingpong` | How a short clip fills the script: `pingpong` or `loop`. |
| `LTX_TIMEOUT_S` | `1800` | The longest generation. |
| `LTX_COMMAND` | `uv run` in `renderer/ltx` | The program that runs `generate.py`. |
| `LTX_MODEL` | LTX-Video 2B 0.9.8 distilled | The weights: a `.safetensors` file or a diffusers repo. |
| `LTX_BASE_MODEL` | `Lightricks/LTX-Video-0.9.5` | Where configs, tokenizer, text encoder and scheduler come from. |
| `LTX_TEXT_ENCODER` | the base model's | Another T5 v1.1 XXL encoder repo. |
| `LTX_DEVICE` | `cuda`, then `mps`, then `cpu` | Where the model runs. |
| `LTX_TEXT_ENCODER_DEVICE` | `LTX_DEVICE` | Where T5 runs. |
| `LTX_DTYPE` | `bfloat16` | `bfloat16`, `float16` or `float32`. |
| `LTX_TIMESTEPS` | the distilled 8-step schedule | Empty: `LTX_STEPS` evenly spaced steps. |
| `LTX_STEPS` | the schedule's length | Denoising steps. |
| `LTX_GUIDANCE` | `1` | Classifier-free guidance. |
| `LTX_VAE_TILING` | `1` | Decodes in tiles to save memory. |
| `LTX_VAE_TILE_FRAMES` | `16` | Frames decoded together. |
| `LTX_PROMPT_CACHE` | `~/.cache/troupe-renderer/ltx-prompts` | Encoded prompts kept between runs; empty turns it off. |

### The browser edition

Read when the site is built (`pnpm site:build`, the `web` image). Details in
[BROWSER-EDITION.md](BROWSER-EDITION.md#configuring-the-renderer),
[SCRIPT-CHAT.md](SCRIPT-CHAT.md#settings) and [LIBRARY.md](LIBRARY.md).

| Variable | Default | What it does |
|---|---|---|
| `VITE_BASE` | `/troupe/` | The URL path the site lives under; `/` for a domain of its own. |
| `VITE_SITE_URL` | `https://maxgfr.github.io/troupe/` | Where it is published: canonical link and social preview. |
| `VITE_REPO_URL` | `https://github.com/maxgfr/troupe` | The repository the landing page links to. |
| `VITE_PORTRAITS_DIR` | `public/actors` | The actors' pictures copied into the site. |
| `VITE_KOKORO_MODEL` | `onnx-community/Kokoro-82M-v1.0-ONNX` | The Kokoro export on the Hugging Face Hub. |
| `VITE_KOKORO_DEVICE` | `auto` | `auto`, `webgpu` or `wasm`. |
| `VITE_KOKORO_DTYPE_WEBGPU` | `fp32` | Weights on WebGPU. |
| `VITE_KOKORO_DTYPE_WASM` | `q8` | Weights on the CPU. |
| `VITE_KOKORO_VOICES` | the built-in casting | As the renderer's `KOKORO_VOICES`. |
| `VITE_SCENE_HUE` | each actor's own | As the renderer's `SCENE_HUE`. |
| `VITE_SCENE_FONT_URL` | Geist | A font file drawn instead: a path under the base or an `https://` URL. |
| `VITE_RENDER_FPS` | `24` | Frames per second. |
| `VITE_RENDER_VIDEO_BITRATE` | `high` | `very-low` to `very-high`, or bits per second. |
| `VITE_RENDER_KEYFRAME_S` | `1` | Seconds between key frames. |
| `VITE_RENDER_AUDIO_BITRATE` | `128000` | Bits per second. |
| `VITE_RENDER_AUDIO_CODECS` | `aac,opus` | Codecs to try, in order. |
| `VITE_WEBLLM_MODEL` | `Qwen2.5-1.5B-Instruct-q4f16_1-MLC` | The chat's WebLLM model. |
| `VITE_WEBLLM_DOWNLOAD_MB` | `880` | Its download size, shown first (0 hides it). |
| `VITE_WEBLLM_TEMPERATURE` | `0.4` | Sampling temperature. |
| `VITE_WEBLLM_MAX_TOKENS` | `1024` | The longest answer. |
| `VITE_CHAT_INSTRUCTIONS` | none | The default house style. |
| `VITE_CHAT_WORDS_PER_SECOND` | `2.5` | The default word budget's rate. |
| `VITE_CHAT_HISTORY_TURNS` | `6` | Earlier turns sent with each request. |
| `VITE_LIBRARY_WHISPER_MODEL` | `onnx-community/whisper-base` | Speech to text. |
| `VITE_LIBRARY_WHISPER_DTYPE` | `q8` | Its weights. |
| `VITE_LIBRARY_EMBED_MODEL` | `Xenova/multilingual-e5-small` | Search by meaning. |
| `VITE_LIBRARY_EMBED_DTYPE` | `q8` | Its weights. |
| `VITE_LIBRARY_DEVICE` | `wasm` | `wasm`, `webgpu` or `auto`. |
| `VITE_LIBRARY_DOWNLOAD_MB` | `195` | Their download size, shown first (0 hides it). |
| `VITE_LIBRARY_MAX_UPLOAD_MB` | `300` | The largest file kept in the browser. |
| `VITE_LIBRARY_MAX_MINUTES` | `15` | The longest video or sound analysed. |
| `VITE_LIBRARY_FRAMES` | `8` | Pictures taken from a video. |

### The CLI

Read by `troupe` ([CLI.md](CLI.md#environment)); its options win.

| Variable | Default | What it does |
|---|---|---|
| `TROUPE_URL` | the profile's, else `http://127.0.0.1:3000` | The studio's address. |
| `TROUPE_PROFILE` | the last one signed in to | The profile to use. |
| `TROUPE_PROJECT` | the profile's current project | The project for project commands (also read by the stack's `cli` service). |
| `TROUPE_CONFIG_DIR` | `$XDG_CONFIG_HOME/troupe` or `~/.config/troupe` | Where `config.json` lives. |
| `TROUPE_INSECURE` | unset | `1` allows plain `http://` to another machine. |

`TROUPE_ACCESS_CODE` (above) signs every command in, too.

## Settings, in the studio

Saved in the database; where a setting also has a variable, Settings wins.

### Settings › Appearance

Dark or light, kept on this device.

### Settings › Default model

The model new launches start on.

### Settings › Cloud models

Turn Veo, Kling and Seedance on or off, and set each one's default format,
length and resolution, price per second (for estimates) and time limit.

### Settings › Script chat

The provider, the Ollama address and model, the Claude model, the house style
and the words per second. In the browser edition: the house style and the
word budget, the model being the build's.

### Settings › Provider accounts

Google, fal.ai and Anthropic keys, encrypted at rest; Test checks one with a
free request. Self-hosted studio only.

### Settings › Local models

Add, test, edit and archive ComfyUI and HTTP models: name, address, token,
defaults, price and time limit.

### Settings › Your data

Browser edition: the storage used, a backup to export and import, and
deleting everything ([BROWSER-EDITION.md](BROWSER-EDITION.md#your-data)).
