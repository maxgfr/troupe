# Browser edition

Troupe comes in two editions with the same pages and the same tRPC router:

- the **self-hosted studio**: Docker or a server, with your API keys and
  model servers ([SELF-HOSTING.md](SELF-HOSTING.md));
- the **browser edition**: a static site for GitHub Pages
  (`maxgfr.github.io/troupe` once published), where everything runs and
  stays in the visitor's browser.

`site/` builds the browser edition for GitHub Pages: the landing page at
`/troupe/` and the app at `/troupe/app/`. There is no server. The pages from
`src/app/(app)` and the full tRPC router run in the browser, on Postgres
compiled to WebAssembly ([PGlite](https://pglite.dev)) and kept in IndexedDB.

```bash
pnpm site:dev       # http://localhost:5173/troupe/
pnpm site:build     # site/dist, ready for GitHub Pages
pnpm site:preview   # serves site/dist at http://localhost:4173/troupe/, deep links as Pages does
pnpm site:test      # Playwright smoke test against the preview (run site:build first)
pnpm site:test:render  # a real render in Chrome (see "Testing a render")
pnpm site:test:chat    # the script chat with WebLLM in Chrome, then a relaunch (local only)
```

`SITE_PORT=4273 pnpm site:test` (or `pnpm site:test:render`) runs it on
another port (for a second checkout), and `SITE_CPU_THROTTLE=6` slows the
page's CPU six times. It does not slow the PGlite worker, so it does not
reproduce a CI runner's slow start. With `CI` set, Playwright retries a
failed test once; a test that only passes on its retry is reported as flaky,
not hidden.

The first visit downloads about 20 MB (Postgres and its data files), then
starts in a few seconds. The first render downloads the voice model too (see
below).

## What each edition does

| In the browser edition | Needs the self-hosted studio |
|---|---|
| Projects, the wizard, actors, versioned scripts with emotions, the benchmark lab and export pages, light and dark themes | Cloud models: they need an API key kept on a server. Settings and the wizard say so, with a link to [SELF-HOSTING.md](SELF-HOSTING.md). |
| Rendering in the browser with **Kokoro voice + captions**: the same voices and picture as the local renderer, played, seeked and downloaded as MP4 | ComfyUI and other model servers: a web page cannot reach servers on your machine |
| Data that survives reloads and new deploys, a backup to export and import, and **Delete all local data** (see [Your data](#your-data)) | Provider accounts (Settings says why instead of the form) |
| The **script chat**, with a small model run by [WebLLM](https://github.com/mlc-ai/web-llm) on the GPU (880 MB, once per browser; needs WebGPU), then Apply & relaunch in the tab ([SCRIPT-CHAT.md](SCRIPT-CHAT.md)) | Ollama and Claude for the chat: no server to keep a key or reach your machine |
| | Background render checks: a render runs in the tab that launched it |

## Your data

Everything the browser edition makes stays in the visitor's browser, for
that site only: the database (IndexedDB `/pglite/troupe`), the renders
(`troupe-media`) and the render jobs in progress (`troupe-render`). Settings →
**Your data** shows:

- **Storage**: what the browser reports with `navigator.storage.estimate()`
  (the voice and chat model downloads count too). Browsers may clear a site's
  data when the device runs low on space; **Keep it on this device** asks
  `navigator.storage.persist()` not to. Chrome and Edge decide by themselves
  (they grant it to sites used often or installed), Firefox asks the visitor.
  A browser without the Storage API shows nothing rather than an error.
- **Backup**: **Export data** saves one file, `troupe-backup-<date>-<time>.tar`,
  with every project, script version, chat message, render, actor choice,
  benchmark and setting. **Import data…** reads one, says what it holds
  (projects, videos, size, date), and replaces everything in this browser
  once confirmed. Every open tab of the studio reloads onto the result.
- **Delete all local data**, after a confirmation, in every open tab. It is
  also offered when the studio cannot load.

Not in a backup: the theme (a per-device choice) and the downloaded model
weights, which download again on first use.

### The backup format

A plain tar archive (POSIX ustar, no compression; any `tar` lists it):

| Entry | Contents |
|---|---|
| `troupe-backup.json` | `{ format: "troupe-backup", version: 1, createdAt, database: { migrations, tables }, media: [{ id, storagePath, type, size }] }` |
| `media/<asset id>` | each render, byte for byte |

`database.migrations` are the migrations the studio had applied, and
`database.tables` every table's rows as Postgres writes them in JSON. Media
entries must be `video/mp4` or `video/webm` (what the studio stores), with
an asset id for a name.

Before anything is shown or written, an import refuses a file that is not a
backup, is incomplete, lists another media type, or comes from a newer build
(a format version or a migration this one does not have), with a sentence
saying which. Once confirmed:

1. The backup's new files are stored, in one IndexedDB transaction: a device
   without room for them fails here, with nothing changed.
2. The database is rebuilt at the backup's migrations, its rows put back and
   every foreign key checked again (a row pointing at one the backup does not
   contain is refused), then the migrations the backup predates run on them,
   exactly as a new deploy would (`restorePglite` in
   `src/server/db/pglite-migrate.ts`), all in one transaction. If it fails,
   the files from step 1 are taken out again and the studio is as it was.
3. Then files the backup replaces or drops are updated, render jobs are
   forgotten, and every tab reloads onto the restored studio.

A tab closed in the middle can leave files that no render refers to; the
studio clears them the next time it starts. The media service worker only
serves `video/mp4` and `video/webm` as such; anything else is sent as a
download (`application/octet-stream`, `nosniff`), never as a page.

### Across deploys

Migrations already applied are recorded in `troupe_static_migrations`, so a
new deploy only applies new ones, on top of the visitor's projects
(`pglite-migrate.test.ts` checks a build that adds a migration keeps them).

## Rendering in the browser

The browser edition's own model, **Kokoro voice + captions**, renders in the
tab that launches it (`site/src/render/`):

1. [kokoro-js](https://github.com/hexgrad/kokoro) voices each line with
   Kokoro-82M, cast by `voiceFor` from `src/modules/scene`, like the local
   renderer. It runs on WebGPU when the browser has it, otherwise in
   WebAssembly on one CPU thread (a page without COOP/COEP headers cannot
   share memory between threads), several times slower.
2. The shared scene (`buildScene`, `drawFrame`) is laid out on the measured
   speech and drawn on an `OffscreenCanvas` in Geist, the font the local
   renderer draws with. The actor card shows the actor's pictures, fetched
   from the site's copy of the cast (`/troupe/actors/`) and decoded with
   `createImageBitmap`.
3. WebCodecs encodes H.264 video and AAC audio, or Opus where the browser has
   no AAC encoder (Chromium on Linux); [mediabunny](https://mediabunny.dev)
   writes the MP4.
4. The studio checks the file with a `<video>` element (there is no ffprobe
   here) and keeps it in IndexedDB, where the media service worker serves it.

Each render is a job in IndexedDB (`troupe-render`). The tab rendering it
holds a Web Lock named after it; a job left unfinished with no tab holding its
lock was cut short by a closed tab, and is marked failed when the studio next
loads or checks on it. The project page shows live progress (the voice model's
download, the lines being voiced, the frames) in every open tab.

**What it needs:** WebCodecs, `OffscreenCanvas`, Web Locks and IndexedDB, so a
recent Chrome or Edge. Other browsers see why rendering is off instead of the
launch button. WebGPU is optional; without it the launch panel warns that the
voices run on the CPU.

**What it downloads:** the Kokoro weights from Hugging Face, once per browser,
kept in Cache Storage (`transformers-cache`, voices in `kokoro-voices`):
326 MB on WebGPU (full precision), 92 MB on the CPU (8-bit). The launch panel
says which, and whether they are already there. ONNX Runtime's WebAssembly
ships with the site.

### Configuring the renderer

A fork can change the renderer when it builds the site, with the variables in
[`site/.env.example`](../site/.env.example) (in `site/.env` or the
environment). The build checks them and stops on a bad value.

| Variable | Default | |
|---|---|---|
| `VITE_KOKORO_MODEL` | `onnx-community/Kokoro-82M-v1.0-ONNX` | a Kokoro-82M v1.0 ONNX export on the Hub |
| `VITE_KOKORO_DEVICE` | `auto` | `auto`, `webgpu` (refuse browsers without it) or `wasm` (always the CPU) |
| `VITE_KOKORO_DTYPE_WEBGPU`, `VITE_KOKORO_DTYPE_WASM` | `fp32`, `q8` | weights per device: `fp32`, `fp16`, `q8`, `q4f16` or `q4` |
| `VITE_KOKORO_VOICES` | the built-in casting | `female=…;male=…` voice ids, as the local renderer's `KOKORO_VOICES` |
| `VITE_RENDER_FPS` | `24` | frames per second |
| `VITE_RENDER_VIDEO_BITRATE` | `high` | `very-low` … `very-high` or bits per second |
| `VITE_RENDER_KEYFRAME_S` | `1` | seconds between key frames (seeking) |
| `VITE_RENDER_AUDIO_BITRATE` | `128000` | bits per second |
| `VITE_RENDER_AUDIO_CODECS` | `aac,opus` | audio codecs to try, in order |
| `VITE_PORTRAITS_DIR` | `public/actors` | the actors' pictures copied to `/troupe/actors/`, a folder laid out like `public/actors` ([ACTORS.md](ACTORS.md)) |
| `VITE_SITE_URL` | `https://maxgfr.github.io/troupe/` | where the site is published: the landing page's canonical link and social preview |
| `VITE_REPO_URL` | `https://github.com/maxgfr/troupe` | the repository the landing page's docs and source links point at |

### Testing a render

`pnpm site:test:render` (after `pnpm site:build`) launches Chrome with a
profile kept in the system temp folder, renders a 6 s clip from a new project,
then checks its size and length, that seeking jumps and plays on through byte
ranges, and the downloaded MP4's streams with `ffprobe`. A second test closes
the tab mid-render and checks the job is failed on the next load. The first
run downloads the voice model.

CI runs it too, headless in Playwright's Chromium
(`HEADLESS=1 RENDER_CHANNEL=chromium pnpm site:test:render`): GitHub's Linux
runners have no GPU, so the voices take the WebAssembly path, and Linux
Chromium has no AAC encoder, so the audio is Opus. The browser profile, whose
Cache Storage holds the 92 MB of weights, is kept with `actions/cache`
(`RENDER_PROFILE` points the test at it), so Hugging Face is only asked again
when the renderer settings (`site/src/render/config.ts`) or the versions of
kokoro-js, Transformers.js or Playwright change (`scripts/model-cache-key.mjs`). Locally,
`RENDER_ARGS="--disable-gpu --disable-features=WebGPU"` forces the CPU path on
a machine with a GPU.

## The landing page

`site/index.html` is the page at `/troupe/`, with its own small stylesheet
and script in `site/src/landing/` (the studio's Tailwind and HeroUI bundle
stays with the app). It shows the presentation video, the steps of a project
(each one jumps the video to its chapter), the cast, the two editions, the
models and the limits. `troupe:landing-addresses` and `troupe:landing-cast`
(`site/vite-plugins.ts`) fill in `VITE_SITE_URL`, `VITE_REPO_URL` and the
base path, and list the cast from the actor catalog with the pictures the
site serves: the `front-160`/`front-320` thumbnails in a `srcset` when the
cast folder has them ([ACTORS.md](ACTORS.md)), `front.webp` otherwise. `pnpm site:test` checks it too (`site/tests/landing.spec.ts`):
the video plays from its poster, the steps jump to their chapters, the quick
start copies, and every link that stays on the site answers.

### The presentation video

`site/public/tour/` holds the video (`troupe-tour.mp4`, H.264 + AAC;
`troupe-tour.webm`, VP9 + Opus; both under 8 MB), its poster and its
chapters, and `site/public/social.png` the social preview. They are made from
the real browser edition, never staged:

```bash
pnpm site:build && pnpm site:preview   # in another terminal
pnpm tour:record                       # headed Chrome drives one project
pnpm tour:edit                         # ffmpeg cuts it into site/public/tour/
```

`scripts/tour/record.ts` creates a project, writes the script, asks the chat
for a punchier hook, applies and relaunches it, lets the tab render, plays the
result and downloads it. It captures Chrome's screencast at twice the page's
size, notes where each step starts and how fast to play it, saves the render
it downloaded, and draws the title cards, captions, poster and social preview
in the site's fonts. The browser profile keeps the voice and chat models
(about 1.2 GB the first time); the site's local data is deleted first. The
chat model is small and its answer changes from one run to the next: watch the
take before keeping it. Keep the real mouse off the Chrome window while it
records (the drawn pointer ignores it, but the page still sees it hover).
`scripts/tour/edit.sh` speeds up the waits (the caption says by how much),
punches in on the chat's proposal and the player, lays the render's own
soundtrack under its playback, and encodes both files to fit `TOUR_MAX_MB`.

| Variable | Default | |
|---|---|---|
| `TOUR_URL` | `http://localhost:4173` | the preview to record |
| `TOUR_OUT` | `<os tmp>/troupe-tour` | footage, cut list, render and cards (record and edit) |
| `TOUR_PROFILE` | `<os tmp>/troupe-tour-profile` | the Chrome profile that keeps the models |
| `TOUR_CHANNEL`, `TOUR_ARGS` | `chrome`, none | the browser and extra Chrome flags |
| `TOUR_PROJECT`, `TOUR_ACTOR`, `TOUR_SCRIPT`, `TOUR_REQUEST` | the cold brew project | the story (`TOUR_SCRIPT` takes `\n` between lines) |
| `TOUR_LINK`, `TOUR_SOCIAL_CAST` | the repository, six actors | the closing card's link and the social preview's faces |
| `TOUR_DEST`, `TOUR_MAX_MB` | `site/public/tour`, `7.5` | where the cut goes and the size cap per file |

`node scripts/tour/record.ts --cards` redraws only the cards (after changing
their text), and `pnpm tour:edit` cuts again from the same footage.

## The inspiration library

The [library](LIBRARY.md) works here too, in the tab: uploads stay in this
browser (with the renders, in the same backups), pictures are taken with a
video element and a canvas, Whisper base and multilingual-e5-small run in a
worker through Transformers.js (about 195 MB, downloaded once, on the CPU;
`VITE_LIBRARY_DEVICE=auto` uses WebGPU), and the analysis's writing, the
library chat and the ideas use the script chat's WebLLM model, so they need
WebGPU. Two things need a server and say so where they would be: saving a
link (a page cannot fetch other sites; save the file and upload it, or paste
the text) and describing the pictures (no vision model small enough runs in a
tab yet). A tab reads videos and sound up to 15 minutes long
(`VITE_LIBRARY_MAX_MINUTES`); a longer one fails at once with the reason.
`VITE_LIBRARY_*` in `site/.env.example` change the models and limits. `pnpm site:test` uploads a clip and searches it; `pnpm
site:test:chat` (WebGPU) also asks about it and makes an idea a project.

## How it is put together

- `site/vite.config.ts`: Vite with `base: "/troupe/"`, `~` mapped to `src/`, and
  `troupe:server-guard`, a plugin (also applied to the worker bundle) that
  fails the build when anything bundled imports a Node built-in (`node:fs` or
  `fs`), dependencies included, and when code from `src/` or `site/` imports a
  server package (`postgres`, Supabase, `server-only`…) or a Next module other
  than `next/link` and `next/navigation`. The one exception is PGlite, allowed
  the built-ins on its Node-only code paths, listed in `vite.config.ts`.
- `site/src/shims/`: `next/link` and `next/navigation` on top of react-router,
  and a stand-in for `src/server/settings/secrets.ts` that refuses to store
  secrets. The shims check their signatures against Next's and the real
  module's types, so `pnpm typecheck` catches drift.
- The rest goes through seams in `src/`: the tRPC context takes the database,
  the media store and the machine description (`createTRPCContext`), and
  `src/app/_components/edition.tsx` tells the pages they run in the browser
  edition, and hands them its data (`site/src/data/`: backups, storage,
  deletion) and its in-browser renderer and chat.
- `site/src/db/`: PGlite in a worker (`idb://troupe`), shared by every open tab;
  the Drizzle migrations are bundled with `import.meta.glob`. Every
  statement is a round trip to the worker, which writes to IndexedDB after
  each one, so code that runs on every start (seeding the actor library)
  works in a few statements, not a few per row. While Delete all local data
  or an import rebuilds the tables, calls from the page wait; a query already
  on its way is asked again once the rebuild is over
  (`site/src/rebuild-link.ts`), so the studio never shows itself empty or
  broken in between.
- `troupe:actor-pictures` (`site/vite-plugins.ts`): the cast lives once in
  the repository, in `public/actors`; `vite dev` serves it and the build
  copies it to `/troupe/actors/`, the same paths the self-hosted app serves.
- `site/public/sw.js`: a service worker that serves renders stored in
  IndexedDB at `/troupe/app/media/<id>`, with byte ranges for seeking.
- `site/src/render/`: the in-browser renderer (above). Its model is a
  `troupe_model_config` row (`browser` family), so Settings can turn it off
  and keep its defaults; `src/modules/generation/server/adapters/browser.ts`
  is its adapter, polled every second.
- `404.html` is a copy of the app, so a deep link such as
  `/troupe/app/projects/<id>` opens the right page.

## Publishing

CI (`.github/workflows/ci.yml`, the `site-smoke` job) builds and tests the
browser edition on every pull request and push to `main`. Deploying it to
GitHub Pages is manual for now: run `.github/workflows/pages.yml` on `main`
from the Actions tab ("Run workflow"; enable Pages with "GitHub Actions" as
the source first). It builds the site again and deploys it.

### With Docker

The Docker stack serves it too: the `web` service (`ghcr.io/maxgfr/troupe-web`,
[site/Dockerfile](../site/Dockerfile)) is the built site behind nginx, at
<http://localhost:3101/troupe/> after `docker compose up -d --wait`
([SELF-HOSTING.md](SELF-HOSTING.md)). nginx sends what the site needs: the
app's routes all load the app (an unknown address gets its not-found page,
as on GitHub Pages), byte ranges for the videos, `text/vtt` captions,
`application/wasm`, the service worker checked on every load, and hashed
bundles cached for a year. To serve it under another path, set
`TROUPE_WEB_BASE` (`/` for a domain of its own) and rebuild:
`docker compose up -d --build web`. Outside Docker the same setting is
`VITE_BASE` ([site/.env.example](../site/.env.example)). The image reads
`site/.env` when it is built, for the renderer and chat settings above.
