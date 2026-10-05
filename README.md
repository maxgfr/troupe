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

## Quick start (Docker)

```bash
git clone https://github.com/maxgfr/troupe.git && cd troupe
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

`docker compose up` pulls the published images (`ghcr.io/maxgfr/troupe*`); to
build them from your checkout, add `--build`. The
[self-hosting guide](docs/SELF-HOSTING.md) covers the services, profiles (CLI,
ComfyUI, the AI video mode), GPUs, volumes, backups and upgrades.

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
render, watch, export and download, with `--json` on every command.

```bash
pnpm --filter troupe-cli build && npm install -g ./cli
troupe login --url http://127.0.0.1:3000
troupe doctor
```

See [docs/CLI.md](docs/CLI.md). On top of it, a Claude Code skill runs the
whole process for you, from the brief to the reviewed MP4:
`/plugin marketplace add maxgfr/troupe`, then `/plugin install troupe@troupe`
([docs/CLAUDE-SKILL.md](docs/CLAUDE-SKILL.md)).

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
- **Docker stack:** end to end on every push (`pnpm e2e:docker`: the studio's
  flow in Chromium with the stack's renderer and a small Ollama model, the
  CLI, the browser edition). The local adapters are tested against real HTTP
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
- Development:

  ```bash
  pnpm install
  docker run -d --name troupe-db -e POSTGRES_PASSWORD=password -e POSTGRES_DB=troupe -p 127.0.0.1:5432:5432 postgres:16-alpine
  DATABASE_URL=postgresql://postgres:password@127.0.0.1:5432/troupe pnpm dev
  ```

  Open <http://localhost:3000>. `pnpm dev` applies migrations on start, needs
  `ffprobe` (FFmpeg) on your PATH, and lets loopback requests in without an
  access code.

Next.js 15, tRPC, Drizzle and PostgreSQL. `pnpm test` replays every migration in
PGlite and needs no API key. See [CONTRIBUTING.md](CONTRIBUTING.md).

[MIT license](LICENSE) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md)
