# Troupe

A self-hosted studio for short AI-generated videos. Pick an actor preset, write a
few lines of dialogue, choose a video model, then preview and download the MP4.
Run the models in the cloud with your own API keys, or on your own GPU through
ComfyUI or any HTTP server.

![The project page: a finished render, its timeline and the launch panel](docs/screenshot.png)

No account, subscription or credits. Cloud providers bill your own account;
local models cost nothing per clip. MIT licensed.

Troupe also has a browser edition: the same studio as a static site that runs
entirely in your browser, renders with Kokoro voices and captions, and keeps
your projects on your device, with a backup you can export and import
([docs/BROWSER-EDITION.md](docs/BROWSER-EDITION.md)).

[![The presentation video: one project in the browser edition, from an empty studio to the downloaded MP4](site/public/tour/troupe-tour.jpg)](site/public/tour/troupe-tour.mp4)

The presentation video (one minute, MP4; [WebM](site/public/tour/troupe-tour.webm)):
one project in the browser edition, recorded in Chrome, waits sped up and
marked. GitHub shows the poster here; the link opens the file. It also plays
on the site's landing page.

## Quick start

Three ways to run it, each from a clone:

```bash
git clone https://github.com/maxgfr/troupe.git && cd troupe
```

### The whole studio, with Docker

```bash
docker compose up -d --wait
```

Nothing to set first. The stack runs the studio and its database, the local
renderer (Kokoro voices and captions, on the CPU), an Ollama server for the
script chat and the browser edition. The first start downloads the chat model
(`qwen3:4b`, 2.5 GB) and the voices (90 MB); `--wait` returns once they are
there. Open <http://localhost:3100> with the access code the studio generated:

```bash
docker compose logs app | grep -A1 "access code"
```

The local renderer is already the default model and the chat already answers:
write a script, ask the chat for a change, render, play, export, without
opening Settings. Add API keys or GPU models there when you want them. The
browser edition is at <http://localhost:3101/troupe/>, and the CLI runs in the
stack: `docker compose run --rm cli doctor`.

`docker compose up` pulls the published images (`ghcr.io/maxgfr/troupe*`,
from the first tagged release on) and builds them from your checkout when
they cannot be pulled, which adds several minutes to the first start; add
`--build` to always build them. Another port or project name
for a second stack: `TROUPE_PORT=3200 TROUPE_WEB_PORT=3201 docker compose -p
troupe-2 up -d --wait`. The
[self-hosting guide](docs/SELF-HOSTING.md) covers the services, profiles (CLI,
ComfyUI, the AI video mode), GPUs, volumes, backups and upgrades.

### The browser edition alone, without a server

```bash
pnpm install
pnpm site:build && pnpm site:preview
```

Open <http://localhost:4173/troupe/>. Projects, renders, the chat (WebGPU)
and the library stay in that browser. The Docker stack serves the same build
at <http://localhost:3101/troupe/>.

### From source, for development

Node.js 22, pnpm 10 (`corepack enable`), Docker for PostgreSQL, and `ffprobe`
(FFmpeg) on your PATH:

```bash
pnpm install
docker run -d --name troupe-db -e POSTGRES_PASSWORD=password -e POSTGRES_DB=troupe -p 127.0.0.1:5432:5432 postgres:16-alpine
DATABASE_URL=postgresql://postgres:password@127.0.0.1:5432/troupe pnpm dev
```

Open <http://localhost:3000>. `pnpm dev` applies migrations on start and lets
loopback requests in without an access code. To render, start the local
renderer next to it (`pnpm renderer`, which needs FFmpeg, or the stack's:
`docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --wait renderer`)
and add the HTTP model `http://127.0.0.1:8078` in Settings
([LOCAL-MODELS.md](docs/LOCAL-MODELS.md#local-renderer)). The chat uses the
Ollama on this computer: `ollama pull qwen3:4b`
([SCRIPT-CHAT.md](docs/SCRIPT-CHAT.md)). [CONTRIBUTING.md](CONTRIBUTING.md)
covers the tests and each part.

## Models

| Model | Where it runs | Audio | Formats | Lengths |
|---|---|---|---|---|
| Veo 3.1 Fast | Google AI (API key) | always | 9:16, 16:9 | 4, 6, 8 s |
| Veo 3.1 Lite | Google AI (API key) | always | 9:16, 16:9 | 4, 6, 8 s |
| Kling 3.0 | fal.ai (API key) | optional | 9:16, 16:9, 1:1 | 3–15 s |
| Seedance 1.5 Pro | fal.ai (API key) | optional | 9:16, 16:9, 1:1 | 4–12 s |
| LTX-Video 2B distilled | your GPU or a 16 GB Mac, via ComfyUI | silent | 9:16, 16:9, 1:1 | 2–5 s |
| LTX-2 | your GPU, via ComfyUI | always | 9:16, 16:9, 1:1 | 4–10 s |
| Wan 2.2 TI2V 5B | your GPU, via ComfyUI | silent | 9:16, 16:9 | 3–5 s |
| Local renderer | your CPU, in the Docker stack by default ([`renderer/`](docs/LOCAL-MODELS.md#local-renderer)): Kokoro voice, actor card, captions | always | 9:16, 16:9, 1:1 | as long as the script |
| Local renderer, AI video mode (opt-in) | your Mac's GPU, natively (NVIDIA GPUs should work, not tried) ([`renderer/ltx`](docs/LOCAL-MODELS.md#ai-video-mode-ltx-video)): an LTX-Video 2B clip under the same voice and captions | always | 9:16, 16:9, 1:1 | as long as the script (a 5 s clip, repeated) |
| Kokoro voice + captions | the visitor's browser, browser edition only ([`site/`](docs/BROWSER-EDITION.md#rendering-in-the-browser)): the same voice and picture | always | 9:16, 16:9, 1:1 | as long as the script (6–30 s clips) |
| Your own | any server that speaks [the HTTP contract](docs/LOCAL-MODELS.md#http-endpoint) | you say | you say | you say |

Each model can be turned off, given default settings, a price per second (for
cost estimates) and a time limit. Pickers only offer what the chosen model
accepts, and warn when a model has only been tried in another language or makes
silent video. See [docs/LOCAL-MODELS.md](docs/LOCAL-MODELS.md) for ComfyUI and
the local renderer, including its AI video mode.

## What it does

- Projects with a platform, format, language and one of 30 actor presets,
  each with six pictures of a synthetic person (front, side views, three
  expressions). The app shows the front one; the renderers' actor card shows
  it too, or the happy, calm or excited one on lines with that emotion (the
  AI video mode draws no card)
  ([docs/ACTORS.md](docs/ACTORS.md) explains how they were made and how to
  replace them).
- Versioned scripts with an emotion per line; restore any earlier version.
- A script chat beside each project: ask for a change, read the proposal
  against the current version, apply it or apply and relaunch the render.
  Ollama by default (the Docker stack runs its own), Claude with an
  Anthropic key, WebLLM in the browser edition ([docs/SCRIPT-CHAT.md](docs/SCRIPT-CHAT.md)).
- An inspiration library: save videos, posts, articles, sound, pictures and
  PDFs (files, pasted text or links); your own models transcribe them, look
  at their pictures, find the hook and the structure, and make them
  searchable by meaning. Ask the library with cited answers, and turn an item
  into idea cards that become a project with its script in one click
  ([docs/LIBRARY.md](docs/LIBRARY.md)).
- Launch on any configured model, follow progress, relaunch failures, compare
  two or three models on the same script and vote.
- Videos are checked with ffprobe before they are kept. Downloads stream with
  range requests.
- Export presets per platform with the AI-disclosure rule each one applies.

With a video model, actor presets describe a voice and a look in the prompt;
they do not keep the same face from one render to the next.

## Command line and Claude Code

`troupe`, the CLI in [`cli/`](cli), drives a running studio from a terminal:
sign in, check the setup, add models, create projects, set scripts, chat,
render, watch, export and download, save to the library, search it and turn
it into ideas, with `--json` on every command.

```bash
pnpm --filter troupe-cli build && npm install -g ./cli
troupe login --url http://127.0.0.1:3000
troupe doctor
```

See [docs/CLI.md](docs/CLI.md). On top of it, a Claude Code skill runs the
whole process for you, from the brief to the reviewed MP4:
`/plugin marketplace add maxgfr/troupe`, then `/plugin install troupe@troupe`
([docs/CLAUDE-SKILL.md](docs/CLAUDE-SKILL.md)).

## Make it yours

Every setting is optional and listed, with its default, in
[docs/CUSTOMIZING.md](docs/CUSTOMIZING.md): models and their limits, voices,
the video's hue and font, the AI video mode, the chat's provider, model,
address and house style, the library's models, the browser edition's base
path and links, and where the colors and the name live for a fork. The test
suite checks that page against the code, so it stays complete.

## How it is put together

| Part | Where | What |
|---|---|---|
| The studio | `src/` | Next.js 15, tRPC, Drizzle and PostgreSQL. Domain logic in `src/modules/<module>` ([map](src/modules/README.md)): projects, scripts, generation (one adapter per provider), the chat, the library, exports. |
| The scene | `src/modules/scene` | What a render draws and says, in plain TypeScript: timed captions, the actor card, the voice casting. Both renderers share it. |
| The local renderer | `renderer/` | A Node server that speaks the [HTTP contract](docs/LOCAL-MODELS.md#http-endpoint): Kokoro voices, the scene on a canvas, ffmpeg; LTX-Video (`renderer/ltx`) and faster-whisper (`renderer/whisper`) in Python, opt-in. |
| The browser edition | `site/` | The same studio's pages built with Vite, its server code running in the browser on PGlite; renders in a worker (kokoro-js, Mediabunny), chat with WebLLM, plus the landing page. |
| The script chat | `src/server/chat`, `src/modules/chat`, `site/src/chat` | Ollama or Claude on the server, WebLLM in the browser, all answering the same JSON schema. |
| The CLI and skill | `cli/`, `skills/troupe` | `troupe`, a client for a running studio, and the Claude Code skill built on it. |
| The stack | `docker-compose.yml`, `ollama/`, `scripts/docker` | One command for all of it; images published on GHCR by `.github/workflows/release.yml`. |

[docs/PRODUCT-MAP.md](docs/PRODUCT-MAP.md) maps the screens.

## Honest status

What was checked, and how (2026-10-05):

- **Cloud video models (Veo, Kling, Seedance) and Claude:** the adapters
  follow the providers' API references of that day and are tested against
  error responses recorded from the live APIs and success responses taken
  from their API references; the Claude chat against a fake server. Settings'
  free key check was run against the live Google and fal.ai
  APIs with invalid keys. **No paid generation has been run**: no Google,
  fal.ai or Anthropic key was available. `pnpm verify:live --yes` runs one at
  each provider's cheapest settings with yours, for about $0.28–0.35
  ([docs/LIVE-CHECKS.md](docs/LIVE-CHECKS.md)).
- **ComfyUI:** the LTX-Video 2B workflow rendered end to end through Troupe on
  an Apple M5 with 16 GB. The LTX-2 and Wan 2.2 workflows were validated by
  ComfyUI 0.38.0 but not rendered ([docs/LOCAL-MODELS.md](docs/LOCAL-MODELS.md#bundled-workflows)).
- **Vercel + Supabase:** run against a local Supabase (Postgres, Storage,
  `pg_cron`, the session pooler) with a production build, renders included;
  not on a real Vercel deployment
  ([docs/VERCEL-SUPABASE.md](docs/VERCEL-SUPABASE.md#what-was-tested)).
- **Inspiration library:** run end to end on an Apple M5 with the default
  models (faster-whisper base, `qwen3-embedding:0.6b`, `qwen3-vl:2b-instruct`,
  `qwen3:4b`), a YouTube link through yt-dlp included, in the Docker stack
  with the smallest models, and in the browser edition (the chat and ideas
  with WebGPU in Chrome). Small models misread now and then: a 1.5B or 0.5B
  model sometimes writes no usable ideas or cites nothing (try again), and
  the analysis says when a step was skipped
  ([docs/LIBRARY.md](docs/LIBRARY.md)).
- **Docker stack:** end to end on every push (`pnpm e2e:docker`: the studio's
  flow in Chromium with the stack's renderer and a small Ollama model, the
  library with its smallest models, the CLI, the browser edition). The local adapters are tested against real HTTP
  servers in the test suite.

Reports are welcome.

## Other ways to run it

- [Self-hosting guide](docs/SELF-HOSTING.md): services and profiles,
  configuration, GPUs, HTTPS behind a reverse proxy, backups, upgrades.
- [Vercel + Supabase](docs/VERCEL-SUPABASE.md): serverless hosting with
  Supabase for the database, files and scheduled job checks.
- [Browser edition](docs/BROWSER-EDITION.md): the same studio built as a
  static site that runs in the browser, with no server; projects stay in that
  browser (export a backup to move them), and videos render in it with Kokoro
  voices and captions.

## License

Troupe is [MIT licensed](LICENSE), the actors' pictures included. Two parts
it builds on carry the GNU GPL, and you should know where:

- The browser edition and the local renderer include eSpeak NG (GPL version
  3 or later), compiled to WebAssembly inside kokoro-js's phonemizer. A built
  browser edition (`site/dist`, the `troupe-web` image) or renderer
  (`troupe-renderer`) is distributed as a whole under the GPL version 3 or
  later, with this repository as its source; Troupe's own files stay MIT.
- The studio's image ships yt-dlp's self-contained build, which bundles GNU
  Readline (GPL), as a separate program it runs (`--build-arg TROUPE_YTDLP=0`
  leaves it out). FFmpeg is run the same way.

Model weights are downloaded at run time, never distributed with Troupe, and
keep their own licenses: Kokoro-82M, Qwen and Whisper are Apache 2.0 or MIT;
the AI video mode's LTX-Video 2B 0.9.8 weights are not open source (a paid
license above $10M annual revenue, and use restrictions such as disclosing
that content is machine generated). [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
lists every component.

[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Code of conduct](CODE_OF_CONDUCT.md) · [Changelog](CHANGELOG.md)
