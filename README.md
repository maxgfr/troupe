# Troupe

Write a short script, cast one of 30 actors and render it as an MP4 with the
models you choose: cloud video models with your own API keys, your own GPU
through ComfyUI, or a renderer that voices and captions it on the CPU. No
account, subscription or credits. MIT licensed.

**[Open Troupe in your browser](https://maxgfr.github.io/troupe/)** ·
[Watch the tour](site/public/tour/troupe-tour.mp4) ·
[Run the whole studio with Docker](#the-whole-studio-with-docker) ·
[Docs](#docs)

[![The tour: one project in the browser edition, from the new-project wizard to the downloaded MP4](docs/images/tour.webp)](site/public/tour/troupe-tour.mp4)

The tour is one project in the browser edition, recorded in Chrome: the
wizard, a three-line script, the script chat rewriting the hook with a model
on the GPU, a render voiced by Kokoro, then the download. Waits are sped up
and marked. This loop is silent and plays a little faster; click it for the
one-minute MP4 with sound ([WebM](site/public/tour/troupe-tour.webm)).

## What it does

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/images/projects-light.webp">
  <img alt="Projects: eight projects, each shown as a poster of its newest render with the actor's card and the first caption" src="docs/images/projects-dark.webp">
</picture>

Projects shows every project as a poster of its newest render, which plays
while you hover it. A project page opens on its actor, with Video, Script and
Export tabs, and keeps the script chat beside the video: ask for a change,
read the proposal against the current version, then apply it, or apply it
and relaunch the render.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/images/project-light.webp">
  <img alt="A project page: the finished render in its player on the left, the script chat on the right with a proposal compared against version 1" src="docs/images/project-dark.webp">
</picture>

The local renderer voices each line with Kokoro, draws the actor card (the
happy, calm or excited picture on lines with that emotion) and lights each
word as it is said. These are frames from four of the renders above:

![Four frames from renders by the local renderer: Fatou, Amara, Ravi and Yuki, each with their actor card and a caption with the spoken word highlighted](docs/images/render-frames.webp)

<details>
<summary>The actors, and a project on a phone</summary>

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/images/actors-light.webp">
  <img alt="Actors: a grid of portraits, each with gender, age range, style and voice" src="docs/images/actors-dark.webp">
</picture>

<p align="center">
<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/images/phone-project-light.webp">
  <img alt="The same project on a 390 px wide phone: the video fills the width, the sections move to a bottom tab bar and the chat opens from a button" src="docs/images/phone-project-dark.webp" width="300">
</picture>
</p>

</details>

The full list:

- Projects with a platform, format, language and one of 30 actor presets,
  each with six pictures of a synthetic person (front, two side views, three
  expressions) and a voice
  ([docs/ACTORS.md](docs/ACTORS.md) explains how they were made and how to
  replace them).
- Versioned scripts with an emotion per line; restore any earlier version.
- The script chat: Ollama by default (the Docker stack runs its own), Claude
  with an Anthropic key, WebLLM in the browser edition
  ([docs/SCRIPT-CHAT.md](docs/SCRIPT-CHAT.md)).
- An inspiration library: save videos, posts, articles, sound, pictures and
  PDFs (files, pasted text or links). Your own models transcribe them, look
  at their pictures, find the hook and the structure, and make them
  searchable by meaning. Ask the library and get cited answers, and turn an
  item into idea cards that become a project with its script in one click
  ([docs/LIBRARY.md](docs/LIBRARY.md)).
- Launch on any configured model, follow progress, relaunch failures, and
  compare two or three models on the same script, then vote.
- Videos are checked with ffprobe before they are kept. Downloads stream with
  range requests.
- Export presets per platform, each with the AI-disclosure rule that
  platform applies.
- The same pages on a phone: the sections move to a bottom tab bar and the
  chat opens as a sheet.

The local renderer and the browser edition show the actor's pictures (the AI
video mode draws no card). A video model gets the voice and the look as a
description in its prompt, so the face can change from one render to the
next.

## Quick start

### In your browser

Open **<https://maxgfr.github.io/troupe/>**. The browser edition is the same
studio as a static site: projects, renders, the chat and the library stay in
that browser, and Settings exports a backup you can import elsewhere. Rendering
needs a recent Chrome or Edge; the chat also needs WebGPU. Cloud models and
model servers on your machine need the self-hosted studio
([docs/BROWSER-EDITION.md](docs/BROWSER-EDITION.md)).

The other ways start from a clone:

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

`docker compose up` pulls the published images (`ghcr.io/maxgfr/troupe*`)
and builds them from your checkout when they cannot be pulled, which adds
several minutes to the first start; add `--build` to always build them.
Another port or project name for a second stack: `TROUPE_PORT=3200
TROUPE_WEB_PORT=3201 docker compose -p troupe-2 up -d --wait`. The
[self-hosting guide](docs/SELF-HOSTING.md) covers the services, profiles (CLI,
ComfyUI, the AI video mode), GPUs, volumes, backups and upgrades.

### The browser edition, built from your clone

```bash
pnpm install
pnpm site:build && pnpm site:preview
```

Open <http://localhost:4173/troupe/>. It is the build published at
maxgfr.github.io; the Docker stack serves it too, at
<http://localhost:3101/troupe/>.

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

## Editions and models

| | Browser edition | Self-hosted studio |
|---|---|---|
| Where it runs | the visitor's browser, from a static site | Docker, a server, or Vercel + Supabase |
| Where your data lives | that browser, with a backup file to export | your database and your disk |
| Video models | Kokoro voice + captions, rendered in the tab | every model in the table below |
| Script chat | WebLLM on the GPU | Ollama or Claude |
| CLI and Claude Code skill | no | yes |

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

Cloud providers bill your own account; local models cost nothing per clip.
Each model can be turned off, given default settings, a price per second (for
cost estimates) and a time limit. Pickers only offer what the chosen model
accepts, and warn when a model has only been tried in another language or makes
silent video. See [docs/LOCAL-MODELS.md](docs/LOCAL-MODELS.md) for ComfyUI and
the local renderer, including its AI video mode.

## Command line and Claude Code

`troupe`, the CLI in [`cli/`](cli), drives a running studio from a terminal:
sign in, check the setup, add models, create projects, set scripts, chat,
render, watch, export and download, save to the library, search it and turn
it into ideas, with `--json` on every command. It made every project in the
screenshots above.

```bash
brew install maxgfr/tap/troupe     # or, from a checkout: pnpm --filter troupe-cli build && npm install -g ./cli
troupe login --url http://localhost:3100
troupe doctor
troupe open
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
  library with its smallest models, the CLI, the browser edition). The local
  adapters are tested against real HTTP servers in the test suite.
- **The screenshots on this page** were taken on 2026-10-07 from the Docker
  stack built from this repository, on an Apple M5 with 16 GB (Docker on the
  CPU). The eight projects were made with the CLI; the local renderer
  rendered each 11 to 17 s video in 9 to 14 s. The chat's proposal is
  `qwen3:4b`'s first answer, unedited.

Reports are welcome.

## Other ways to run it

- [Self-hosting guide](docs/SELF-HOSTING.md): services and profiles,
  configuration, GPUs, HTTPS behind a reverse proxy, backups, upgrades.
- [Vercel + Supabase](docs/VERCEL-SUPABASE.md): serverless hosting with
  Supabase for the database, files and scheduled job checks.
- [Browser edition](docs/BROWSER-EDITION.md): how the static site works,
  where its data lives, what it downloads, and how to publish your own.

## Docs

| Read | For |
|---|---|
| [SELF-HOSTING.md](docs/SELF-HOSTING.md) | The Docker stack: services, profiles, GPUs, HTTPS, backups, upgrades |
| [BROWSER-EDITION.md](docs/BROWSER-EDITION.md) | The static site: what it does, your data, rendering in the browser, publishing |
| [VERCEL-SUPABASE.md](docs/VERCEL-SUPABASE.md) | Serverless hosting |
| [LOCAL-MODELS.md](docs/LOCAL-MODELS.md) | The local renderer, its AI video mode, ComfyUI, the HTTP contract |
| [SCRIPT-CHAT.md](docs/SCRIPT-CHAT.md) | The script chat and its models |
| [LIBRARY.md](docs/LIBRARY.md) | The inspiration library |
| [ACTORS.md](docs/ACTORS.md) | The 30 actors: how they were made, how to replace them |
| [CLI.md](docs/CLI.md) · [CLAUDE-SKILL.md](docs/CLAUDE-SKILL.md) | The `troupe` CLI and the Claude Code skill |
| [CUSTOMIZING.md](docs/CUSTOMIZING.md) | Every setting, with its default |
| [LIVE-CHECKS.md](docs/LIVE-CHECKS.md) | Checking real providers with your keys |
| [PRODUCT-MAP.md](docs/PRODUCT-MAP.md) · [DESIGN.md](DESIGN.md) · [PRODUCT.md](PRODUCT.md) | Screens and words, the visual system, the principles |
| [AUDIT.md](docs/AUDIT.md) | The baseline audit of 2026-10-04 |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each release |

## Releases

Every release is a tag, a [GitHub Release](https://github.com/maxgfr/troupe/releases)
with generated notes, the CLI in one file and the browser edition attached,
and the five images on GHCR, all made from the commit messages when `main`
moves ([CONTRIBUTING.md](CONTRIBUTING.md#releases)).

## Contributing

Changes that make the script to video to download path more reliable, add
models or make self-hosting easier are the most welcome.
[CONTRIBUTING.md](CONTRIBUTING.md) explains how to run each part and its
tests; `pnpm lint`, `pnpm typecheck` and `pnpm test` run before every merge.
[Security](SECURITY.md) · [Code of conduct](CODE_OF_CONDUCT.md)

## License

Troupe is [MIT licensed](LICENSE), the actors' pictures included. Two parts
it builds on carry the GNU GPL, and you should know where:

- The browser edition and the local renderer include eSpeak NG (GPL version
  3 or later), compiled to WebAssembly inside kokoro-js's phonemizer. A built
  browser edition (`site/dist`, the `troupe-web` image, the site at
  maxgfr.github.io) or renderer (`troupe-renderer`) is distributed as a whole
  under the GPL version 3 or later, with this repository as its source;
  Troupe's own files stay MIT.
- The studio's image ships yt-dlp's self-contained build, which bundles GNU
  Readline (GPL), as a separate program it runs (`--build-arg TROUPE_YTDLP=0`
  leaves it out). FFmpeg is run the same way.

The GPL's full text is in [LICENSES/GPL-3.0.txt](LICENSES/GPL-3.0.txt). The
studio, renderer, CLI and `troupe-web` images carry `LICENSE`,
`THIRD_PARTY_NOTICES.md` and that text in `/usr/share/doc/troupe/`, the
`troupe-ollama` image carries Ollama's license and notice in
`/usr/share/doc/ollama/`, and the built browser edition carries all three at
`licenses/`.

Model weights are downloaded at run time, never distributed with Troupe, and
keep their own licenses: Kokoro-82M, Qwen and Whisper are Apache 2.0 or MIT;
the AI video mode's LTX-Video 2B 0.9.8 weights are not open source (a paid
license above $10M annual revenue, and use restrictions such as disclosing
that content is machine generated). [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
lists every component.
