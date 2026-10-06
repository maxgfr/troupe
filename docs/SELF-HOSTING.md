# Self-hosting Troupe

One command starts the whole product with Docker Compose: the studio, its
database, a local renderer that voices and captions scripts on the CPU, an
Ollama server for the script chat, and the browser edition. Nothing has to be
set first: the database password, the access code and the encryption key are
generated on first start, the renderer is added as a video model and the chat
talks to the stack's Ollama.

## Install

```bash
git clone https://github.com/maxgfr/troupe.git && cd troupe
docker compose up -d --wait
```

`--wait` returns once every service is healthy. The first start downloads the
images and two models (see [What the first start downloads](#what-the-first-start-downloads));
later starts take seconds. Then:

```bash
docker compose logs app | grep -A1 "access code"
```

prints the access code. Open <http://localhost:3100> and enter it: the local
renderer is already the default video model and the script chat already
answers, so a new project can go from script to chat to render to export
without visiting Settings. The browser edition is at
<http://localhost:3101/troupe/>.

`docker compose up` pulls the published images (`ghcr.io/maxgfr/troupe*`).
To build them from your checkout instead: `docker compose up -d --wait --build`.

## What runs

| Service | Image | Port on the host | What it does |
|---|---|---|---|
| `app` | `ghcr.io/maxgfr/troupe` ([Dockerfile](../Dockerfile)) | `127.0.0.1:3100` | The studio. Applies database migrations on start, checks running renders every 30 seconds, and on first start adds the renderer as a model ([first-start wiring](#first-start-wiring)). |
| `db` | `postgres:16-alpine` | none | The database. Generates its password on first start. |
| `renderer` | `ghcr.io/maxgfr/troupe-renderer` ([renderer/Dockerfile](../renderer/Dockerfile)) | none (`docker-compose.dev.yml` publishes `127.0.0.1:8078`) | The local renderer: Kokoro voices, the actor card and captions, encoded with ffmpeg, on the CPU ([LOCAL-MODELS.md](LOCAL-MODELS.md#local-renderer)). |
| `ollama` | `ghcr.io/maxgfr/troupe-ollama` ([ollama/Dockerfile](../ollama/Dockerfile)) | none | The script chat's model server: the official Ollama build (the version is pinned in that Dockerfile) without its GPU libraries, run as a user. Downloads the chat model on first start, retrying while the network fails; a model name the Ollama library does not know stops the service with that message. |
| `web` | `ghcr.io/maxgfr/troupe-web` ([site/Dockerfile](../site/Dockerfile)) | `127.0.0.1:3101` | The browser edition and its landing page, served by nginx ([BROWSER-EDITION.md](BROWSER-EDITION.md)). It only serves files: projects and renders stay in each visitor's browser. |

On demand, with a [profile](https://docs.docker.com/compose/how-tos/profiles/):

| Profile | Service | What it adds |
|---|---|---|
| `cli` | `cli` (`ghcr.io/maxgfr/troupe-cli`, [cli/Dockerfile](../cli/Dockerfile)) | The `troupe` CLI, already signed in: `docker compose run --rm cli doctor` ([below](#the-cli-in-the-stack)). |
| `comfyui` | `comfyui` | ComfyUI on an NVIDIA GPU, for LTX-2 and Wan 2.2 ([LOCAL-MODELS.md](LOCAL-MODELS.md)). |
| `ltx` | `renderer-ltx` (built from this checkout) | The renderer's AI video mode (LTX-Video) on an NVIDIA GPU ([LOCAL-MODELS.md](LOCAL-MODELS.md#in-docker)). |
| `ltx-cpu` | `renderer-ltx-cpu` | The same without a GPU: it works, at minutes to hours per clip. |

| Service | Health check | Runs as | Restarts |
|---|---|---|---|
| `app` | `/api/health` (the database answers) | `node` | unless stopped |
| `db` | `pg_isready` | starts as root, then the server runs as `postgres` | unless stopped |
| `renderer`, `renderer-ltx`, `renderer-ltx-cpu` | `/health` | `node` | unless stopped |
| `ollama` | every model in `TROUPE_OLLAMA_MODELS` is there | `ollama` (uid 10001), with `docker-compose.gpu.yml` too | unless stopped |
| `web` | `/healthz` | `nginx` | unless stopped |
| `cli` | none: it runs one command and exits (`run --rm`) | `node` | no |
| `comfyui` | none (third-party image) | root (third-party image) | unless stopped |

`docker compose ps` shows their health.

### Memory

Each service has a memory limit, set high enough for its defaults:

| Variable | Default | |
|---|---|---|
| `TROUPE_APP_MEMORY` | `2g` | the studio |
| `TROUPE_DB_MEMORY` | `1g` | PostgreSQL |
| `TROUPE_RENDERER_MEMORY` | `2g` | Kokoro and ffmpeg peaked at 870 MB for a 720p clip |
| `TROUPE_OLLAMA_MEMORY` | `8g` | `qwen3:4b` peaked at 3.5 GB while answering; a larger model needs more |
| `TROUPE_WEB_MEMORY` | `128m` | nginx |

Docker Desktop gives its virtual machine a share of the computer's memory
(Settings → Resources): the whole stack with `qwen3:4b` is comfortable with
8 GB.

## What the first start downloads

| What | Size | Where it is kept |
|---|---|---|
| The images: `troupe` 580 MB, `troupe-renderer` 1.9 GB, `troupe-ollama` 220 MB, `troupe-web` 195 MB, `postgres` 410 MB (`troupe-cli` 240 MB with the `cli` profile) | about 3.3 GB on disk. The inspiration library added 85 MB to `troupe` (yt-dlp, article and PDF reading) and 580 MB to `troupe-renderer` (Python and faster-whisper); before it, Troupe's five images compressed to about 610 MB | Docker's image store |
| The chat model, `qwen3:4b` | 2.5 GB | the `ollama` volume |
| Kokoro-82M, 8-bit (`onnx-community/Kokoro-82M-v1.0-ONNX`) | about 90 MB | the `renderer` volume |
| After the chat model, in the background: the library's search and vision models, `qwen3-embedding:0.6b` and `qwen3-vl:2b-instruct` (skipped with `TROUPE_LIBRARY=0`) | 639 MB and 1.9 GB | the `ollama` volume |
| On the first transcription: Whisper base (`Systran/faster-whisper-base`) | about 145 MB | the `renderer` volume |

Sizes are those of the linux/arm64 images on Docker Desktop. On an Apple M5
Mac with the images already built, the first `docker compose up -d --wait`
took 7.7 minutes, nearly all of it downloading `qwen3:4b` at about 6 MB/s;
later starts take about 10 seconds. The `ollama` service reports healthy
only once its models are there, so `docker compose up --wait` returns when the
chat is ready; the studio itself opens as soon as `app` is healthy, and the
chat says the model is missing until the download ends.

## First-start wiring

With `TROUPE_AUTOCONFIGURE=1` (the Compose default), the app checks on every
start whether it has added the stack's renderer, and adds it if not: the same
model a person would add under **Settings → Local models** with **Test** then
**Add model** (formats 9:16, 16:9 and 1:1, every resolution, the clip lengths
below, audio always, the polling pace the renderer asks for). If no default
model was chosen yet, it becomes the default. It waits for the renderer for up
to ten minutes, in the background.

It happens once. A renderer you renamed, archived or replaced as the default
stays that way; the app logs `"outcome":"exists"` and does nothing. It also
does nothing when a model at the same address, or with the same name, is
already there. Turn it off with `TROUPE_AUTOCONFIGURE=0`.

The chat needs no wiring: Compose points `OLLAMA_URL` at the stack's Ollama
and `OLLAMA_MODEL` at the model it downloads. **Settings → Script chat**
overrides both, as always.

| Variable | Default | What it does |
|---|---|---|
| `TROUPE_AUTOCONFIGURE` | `1` in Compose, off otherwise | `0` turns the first-start wiring off. |
| `TROUPE_RENDERER_URL` | `http://renderer:8078` | Where the app finds the renderer it adds. |
| `TROUPE_RENDERER_LABEL` | `Local renderer` | The model's name in the studio. |
| `TROUPE_RENDERER_DURATIONS` | `4,6,8,10,15` | The clip lengths it offers, in seconds (1 to 60). |
| `TROUPE_RENDERER_TOKEN` | none | A token the renderer requires (`Authorization: Bearer`); the app saves it encrypted with the model. |

## Configuration

Everything is optional. Put what you change in `.env` next to
`docker-compose.yml` ([.env.example](../.env.example) lists every variable).

| Variable | Default | What it does |
|---|---|---|
| `TROUPE_BIND` | `127.0.0.1` | Address the studio and the browser edition listen on. Keep `127.0.0.1` behind a reverse proxy; `0.0.0.0` exposes them to your network. |
| `TROUPE_PORT` | `3100` | The studio's port on the host. |
| `TROUPE_WEB_PORT` | `3101` | The browser edition's port on the host. |
| `TROUPE_WEB_BASE` | `/troupe/` | The path the browser edition is served under (`/` for the root). Written into its files: rebuild with `docker compose up -d --build web` after changing it. |
| `TROUPE_ACCESS_CODE` | generated | The code that opens the studio, at least 12 characters. If empty, one is generated, printed in the logs and saved as `access-code` in the data volume. Changing it signs every browser out. After five wrong codes an address waits 15 minutes. |
| `TROUPE_SECRET` | generated | Encrypts saved API keys and local model tokens (AES-256-GCM). If empty, a random key is saved as `secret.key` in the data volume. **Back it up**: without it saved keys cannot be read and must be entered again. |
| `POSTGRES_PASSWORD` | generated | The database password. If empty, `db` generates one on first start and keeps it in the `troupe-secrets` volume, where `app` reads it. Set it only to keep a database created with a password of your own (hex characters, so it fits in a URL). |
| `DATABASE_URL` | built for `db` | Another PostgreSQL server; the `db` service then sits idle. |
| `GOOGLE_GENAI_API_KEY` (or `GEMINI_API_KEY`), `FAL_KEY` | — | Optional provider keys. Keys saved in Settings take precedence; Settings → Provider accounts → Test checks each one for free. |
| `TROUPE_MODEL_IDS` | — | A newer upstream id for a built-in model, as `key=id` pairs separated by commas, e.g. `veo-3.1-fast=veo-3.1-fast-generate-001,kling-3.0=fal-ai/kling-video/v3/pro/text-to-video`. The model keeps its formats and lengths, so the replacement must accept them. |
| `OLLAMA_MODEL` | `qwen3:4b` | The chat model: `ollama` downloads it, `app` uses it ([SCRIPT-CHAT.md](SCRIPT-CHAT.md)). Any model that follows a JSON schema. |
| `TROUPE_OLLAMA_MODELS` | `OLLAMA_MODEL` | Every model `ollama` downloads and waits for, separated by commas. |
| `OLLAMA_URL` | `http://ollama:11434` | Another Ollama, such as one installed on this computer: `http://host.docker.internal:11434` (on Linux, start it with `OLLAMA_HOST=0.0.0.0`). Then run the stack without its own: `docker compose up -d --wait --scale ollama=0`. |
| `OLLAMA_KEEP_ALIVE` | `30m` | How long Ollama keeps the model loaded after an answer. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | —, `claude-opus-5-5` | The script chat uses Claude when a key is set (or saved in Settings). |
| `TROUPE_CHAT_PROVIDER`, `TROUPE_CHAT_INSTRUCTIONS`, `TROUPE_CHAT_WORDS_PER_SECOND`, `TROUPE_CHAT_TIMEOUT_S`, `TROUPE_CHAT_SEND_TIMEOUT_S`, `TROUPE_CHAT_TEMPERATURE`, `TROUPE_CHAT_HISTORY_TURNS` | `auto`, —, `2.5`, `180`, `300`, provider's own, `6` | The chat's provider choice, house style, word-budget rate, answer time limit, request time limit (answer and retry together), sampling temperature (sent to Claude only for the models that accept one) and history kept ([SCRIPT-CHAT.md](SCRIPT-CHAT.md#settings)). Settings → Script chat overrides the first three. |
| `TROUPE_RENDERER_KOKORO_DTYPE`, `TROUPE_RENDERER_KOKORO_VOICES`, `TROUPE_RENDERER_PORTRAITS_DIR` | `q8`, built-in casting, `./public/actors` | The renderer's weights, voices and actors' pictures ([LOCAL-MODELS.md](LOCAL-MODELS.md#run-it)). |
| `TROUPE_RENDERER_PORT` | `8078` | With `docker-compose.dev.yml` only: the renderer's port on `127.0.0.1`, for a studio run with `pnpm dev`. |
| `TROUPE_LIBRARY`, `TROUPE_LIBRARY_EMBED_MODEL`, `TROUPE_LIBRARY_VISION_MODEL` | `1`, `qwen3-embedding:0.6b`, `qwen3-vl:2b-instruct` | The [inspiration library](LIBRARY.md) and the Ollama models it searches and looks with (`off` skips one). `ollama` pulls them after the chat model, without holding up the start. |
| `TROUPE_TRANSCRIPTION`, `TROUPE_WHISPER_MODEL` | `1`, `base` | The renderer's Whisper for the library ([LIBRARY.md](LIBRARY.md#settings) lists the library's other settings). |
| `TROUPE_VERSION` | `latest` | Image tag to run, e.g. `0.1.0`. |

Inside the app container: `TROUPE_DATA_DIR=/app/data` (videos, `access-code`,
`secret.key`), `TROUPE_INPROCESS_WORKER=1` (background job checks) and
`TROUPE_AUTO_MIGRATE` (set it to `0` to apply migrations yourself; never on Vercel).

The app always requires the access code in production. Requests are refused
whatever their `Host` header says.

## Volumes

| Volume | Holds | Back it up |
|---|---|---|
| `troupe-pgdata` | the database | yes (with `pg_dump`, below) |
| `troupe-media` | videos, `access-code`, `secret.key` | yes |
| `troupe-secrets` | the generated database password | yes, with the database |
| `troupe-cli-access` | a copy of the generated access code, for the `cli` service | no: the studio writes it on every start |
| `ollama` | the chat models | no: they download again |
| `renderer` | Kokoro's weights and finished renders | no: the studio keeps its own copy of every video |
| `cli-config` | the CLI's profiles and chosen project | no |
| `comfyui`, `renderer-ltx` | the optional profiles' models | no: they download again (large) |

Compose prefixes each name with the project's, by default `troupe_`
(`troupe_troupe-media`).

## The CLI in the stack

```bash
docker compose run --rm cli doctor
docker compose run --rm cli projects list
docker compose run --rm cli render list --project "Spring drop"
docker compose run --rm cli download --project "Spring drop"
```

The `cli` service reaches the studio at `http://app:3000` and signs in with the
access code the studio generated, which the studio copies into a volume of its
own (`troupe-cli-access`, mounted read-only: the CLI never sees the data
volume and its `secret.key`), or with `TROUPE_ACCESS_CODE` when you set one. Files it downloads land in this folder
(`TROUPE_CLI_DIR` to choose another; on Linux it must be writable by uid 1000).
Everything else about the CLI is in [CLI.md](CLI.md).

## GPUs

- **Chat on an NVIDIA GPU**: lay `docker-compose.gpu.yml` over the stack. It
  builds the official Ollama image (with CUDA, about 7 GB) at the version
  pinned in [ollama/Dockerfile](../ollama/Dockerfile), as the same user, and
  runs it on the GPU; the
  [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/)
  must be installed.

  ```bash
  docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --wait --build ollama
  ```

- **Video on an NVIDIA GPU**: the `comfyui` and `ltx` profiles.
- **On a Mac**, containers cannot use the Apple GPU (Metal is not available
  in Docker's Linux virtual machine). The stack runs everything on the CPU,
  which is fine for the renderer and a small chat model. For a faster chat,
  run [Ollama for macOS](https://ollama.com/download) natively and set
  `OLLAMA_URL=http://host.docker.internal:11434`; for the AI video mode, run
  the renderer natively (`pnpm renderer:ltx`, [LOCAL-MODELS.md](LOCAL-MODELS.md#ai-video-mode-ltx-video)).

## HTTPS with a reverse proxy

Keep `TROUPE_BIND=127.0.0.1` and put a proxy in front. With
[Caddy](https://caddyserver.com), which obtains certificates by itself:

```caddyfile
studio.example.com {
    reverse_proxy 127.0.0.1:3100
}

web.example.com {
    reverse_proxy 127.0.0.1:3101
}
```

Caddy sends `X-Forwarded-Host` and `X-Forwarded-Proto`; Troupe uses them to
check request origins and to mark its session cookie `Secure`. Other proxies
(nginx, Traefik) work the same if they forward those two headers. The browser
edition needs HTTPS (or `localhost`) for its service worker, WebGPU and the
clipboard.

## Backups

Back up four things together:

1. **The database**:

   ```bash
   docker compose exec -T db pg_dump -U postgres troupe | gzip > troupe-$(date +%F).sql.gz
   ```

2. **The data volume** (videos, `access-code`, `secret.key`):

   ```bash
   docker run --rm -v troupe_troupe-media:/data -v "$PWD":/backup alpine tar czf /backup/troupe-data-$(date +%F).tgz -C /data .
   ```

3. **The generated database password**:

   ```bash
   docker run --rm -v troupe_troupe-secrets:/secrets -v "$PWD":/backup alpine tar czf /backup/troupe-secrets-$(date +%F).tgz -C /secrets .
   ```

4. **`.env`**, especially `TROUPE_SECRET` and `POSTGRES_PASSWORD` if you set them.

To restore, recreate the volumes, unpack the archives into
`troupe_troupe-media` and `troupe_troupe-secrets`, start only `db`, pipe the
dump into `psql -U postgres troupe`, then start the rest.

## Upgrade

```bash
docker compose pull
docker compose up -d --wait
```

Migrations run on start; several app containers starting at once wait for one
another. To pin a version, set `TROUPE_VERSION=0.1.0` in `.env`. The model
volumes are kept, so nothing downloads again unless `OLLAMA_MODEL` changed.

### From a stack without the renderer, Ollama and web services

Earlier versions ran only `app` and `db`, needed `POSTGRES_PASSWORD` in `.env`,
and used the Ollama on the host.

- Keep `POSTGRES_PASSWORD` in `.env`: the database was created with it. The
  generated password only applies to a new database: without either, `db`
  refuses to start and says so ([troubleshooting](#troubleshooting)).
- The chat now uses the stack's Ollama. To keep the one on your computer, set
  `OLLAMA_URL=http://host.docker.internal:11434` and start with
  `--scale ollama=0`.
- A renderer you added in Settings at `http://renderer:8078` is kept, and the
  first-start wiring does not add a second one.

### From a version before 0.1.0

Earlier versions ran migrations and the job worker as separate services, used
a fixed database password and ran the container as root.

- Set `POSTGRES_PASSWORD=password` in `.env` to keep the existing database (then
  change it with `ALTER USER postgres PASSWORD '…'` and update `.env`).
- The app now runs as the `node` user. If the old data volume belongs to root:

  ```bash
  docker compose run --rm --user root app chown -R node:node /app/data
  ```

- `docker compose up -d --remove-orphans` removes the old `migrate` and `worker`
  containers.

## Local models

The stack's renderer is added for you. Add ComfyUI or your own model server in
**Settings → Local models**. From the container, a server running on the same
computer is at `http://host.docker.internal:<port>` (ComfyUI: `:8188`, `:8000`
for ComfyUI Desktop). With an NVIDIA GPU you can run ComfyUI in the same stack:

```bash
docker compose --profile comfyui up -d
```

and use `http://comfyui:8188`. Details in [LOCAL-MODELS.md](LOCAL-MODELS.md).

## Testing the stack

`pnpm e2e:docker` (Node.js 22+, pnpm and Docker) builds every image from the
checkout, starts the stack under its own Compose project (`troupe-e2e`, ports
3190 and 3191, a small chat model, `qwen2.5:0.5b`), and runs in Chromium:

- the studio's whole flow: sign in with the generated access code, new
  project, script, a chat request answered by the stack's Ollama, the render
  on the stack's renderer, playback, export and download (checked with
  `ffprobe`), without opening Settings;
- the CLI in its container: `doctor`, `projects list`, `render list`,
  `download`;
- the stack: health, the access code in the logs, a spoofed `Host` header
  refused, the browser edition's security headers, a restart that keeps the
  data and adds nothing twice;
- the images on their own: the licenses the Ollama image carries, and the
  database's password script from `docker-compose.yml` (generated for a new
  database, refused for an existing one without it);
- the browser edition served by `web`, under its Content-Security-Policy: its
  smoke tests, landing page tests and its renders in the page (a render
  played, seeked and downloaded; one cut short by closing its tab; a backup
  that brings the video back; `E2E_WEB_RENDER=0` skips them);
  `E2E_WEB_CHAT=1` adds the WebLLM chat, which needs headed Chrome with
  WebGPU.

It then deletes that project's containers and volumes, never another's.
Model downloads are kept in `.cache/e2e` between runs. `E2E_KEEP=1` leaves the
stack running; [scripts/e2e-docker.ts](../scripts/e2e-docker.ts) lists the
other settings. CI runs it on every push (`docker-e2e` in
[ci.yml](../.github/workflows/ci.yml)), with the images and model downloads
cached.

Measured on an Apple M5 Mac (Docker Desktop, 10 CPUs, 8 GB for its virtual
machine), images and model downloads from earlier runs kept:

| Step | Time |
|---|---|
| Building the images (cached layers, after a source change) | 26 s |
| First start, `qwen2.5:0.5b` (397 MB) not yet downloaded | 81 s |
| First start, model already in `.cache/e2e` | 8 s |
| The 23 tests | 2.3 minutes |
| The whole run | 2.9 minutes |

On a CI runner, add installing Playwright's Chromium and the first build of
the images (BuildKit's cache then keeps them).

## Troubleshooting

- `docker compose ps` shows a service as unhealthy: `docker compose logs <service>`.
  The app's health check (`/api/health`) fails while the database is unreachable.
- `ollama` stays "starting" for minutes on first start: it is downloading the
  chat model; `docker compose logs -f ollama` shows the progress (and the
  retries, when the network fails). `ollama` restarting over and over with
  "The Ollama library has no model called …": fix the name in `OLLAMA_MODEL`
  or `TROUPE_OLLAMA_MODELS`.
- `db` restarting over and over with "this database was created with a
  password that is set nowhere now", or `app` logging `password
  authentication failed`: the database exists but its password is neither in
  `.env` (`POSTGRES_PASSWORD`) nor in the `troupe-secrets` volume, typically
  after an upgrade from a stack that needed `POSTGRES_PASSWORD` with a lost
  or replaced `.env`. Put the original password back in `.env` as
  `POSTGRES_PASSWORD` ([upgrade](#upgrade)), or restore the `troupe-secrets`
  volume from its backup. Nothing is generated over an existing database.
- The renderer is not in the model list: `docker compose logs app | grep autoconfigure`
  says why (`unreachable`, `name-taken`, `already-added`, `exists`).
- Settings → Background checks shows when job checks last ran. Older than five
  minutes means the app process is not running.
- A render marked "did not finish before its time limit" may still be running
  at the provider. Check its dashboard before relaunching.
