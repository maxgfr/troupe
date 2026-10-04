# Troupe

A self-hosted studio for short AI-generated videos. Pick an actor preset, write a
few lines of dialogue, choose a video model, then preview and download the MP4.
Run the models in the cloud with your own API keys, or on your own GPU through
ComfyUI or any HTTP server.

![The project page: a finished render, its timeline and the launch panel](docs/screenshot.png)

No account, subscription or credits. Cloud providers bill your own account;
local models cost nothing per clip. MIT licensed.

## Quick start (Docker)

```bash
git clone https://github.com/maxgfr/troupe.git && cd troupe
cp .env.example .env && sed -i.bak "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=\"$(openssl rand -hex 24)\"/" .env
docker compose up -d
```

Open <http://localhost:3100>. On first start the app generates an access code and
prints it in its logs:

```bash
docker compose logs app | grep -A1 "access code"
```

Then go to **Settings** to add an API key or a local model. The database, your
videos, the access code and the key that encrypts saved API keys live in two
Docker volumes; see [backups](docs/SELF-HOSTING.md#backups).

`docker compose up` pulls the published image (`ghcr.io/maxgfr/troupe`). To build
from your checkout instead, run `docker compose up -d --build`.

## Models

| Model | Where it runs | Audio | Formats | Lengths |
|---|---|---|---|---|
| Veo 3.1 Fast | Google AI (API key) | always | 9:16, 16:9 | 4, 6, 8 s |
| Kling 3.0 | fal.ai (API key) | optional | 9:16, 16:9, 1:1 | 3–15 s |
| Seedance 1.5 Pro | fal.ai (API key) | optional | 9:16, 16:9, 1:1 | 4–12 s |
| LTX-2 | your GPU, via ComfyUI | always | 9:16, 16:9, 1:1 | 4–10 s |
| Wan 2.2 TI2V 5B | your GPU, via ComfyUI | silent | 9:16, 16:9 | 3–5 s |
| Local renderer | your CPU ([`renderer/`](docs/LOCAL-MODELS.md#local-renderer)): Kokoro voice, actor card, captions | always | 9:16, 16:9, 1:1 | as long as the script |
| Kokoro voice + captions | the visitor's browser, static demo only ([`site/`](docs/STATIC-SITE.md#rendering-in-the-browser)): the same voice and picture | always | 9:16, 16:9, 1:1 | as long as the script (6–30 s clips) |
| Your own | any server that speaks [the HTTP contract](docs/LOCAL-MODELS.md#http-endpoint) | you say | you say | you say |

Each model can be turned off, given default settings, a price per second (for
cost estimates) and a time limit. Pickers only offer what the chosen model
accepts, and warn when a model has only been tried in another language or makes
silent video. See [docs/LOCAL-MODELS.md](docs/LOCAL-MODELS.md) for ComfyUI and
the local renderer.

## What it does

- Projects with a platform, format, language and one of 30 actor presets.
- Versioned scripts with an emotion per line; restore any earlier version.
- Launch on any configured model, follow progress, relaunch failures, compare
  two or three models on the same script and vote.
- Videos are checked with ffprobe before they are kept. Downloads stream with
  range requests.
- Export presets per platform with the AI-disclosure rule each one applies.

Actor presets describe a voice and a look in the prompt; they do not keep the
same face from one render to the next.

## Honest status

The cloud adapters are tested against recorded API responses, the local
adapters against real HTTP servers in the test suite, and the Docker image end
to end with the [example model server](examples/http-model). **Paid generations
with real Google and fal.ai keys have not been run for this release, and the
bundled ComfyUI workflows were validated by ComfyUI 0.38.0 but not rendered
end to end.** Reports are welcome.

## Other ways to run it

- [Self-hosting guide](docs/SELF-HOSTING.md): configuration, HTTPS behind a
  reverse proxy, backups, upgrades.
- [Vercel + Supabase](docs/VERCEL-SUPABASE.md): serverless hosting with
  Supabase for the database, files and scheduled job checks.
- [Static demo](docs/STATIC-SITE.md): the same studio built as a static site
  that runs in the browser, with no server; projects stay in that browser,
  and videos render in it with Kokoro voices and captions.
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
