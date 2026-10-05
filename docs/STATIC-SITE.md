# Static site

`site/` builds the studio as a static site for GitHub Pages: the landing page
at `/troupe/` and the app at `/troupe/app/`. There is no server. The pages
from `src/app/(app)` and the full tRPC router run in the browser, on Postgres
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
reproduce a CI runner's slow start.

The first visit downloads about 20 MB (Postgres and its data files), then
starts in a few seconds. The first render downloads the voice model too (see
below).

## What works and what does not

| Works in the demo | Needs the self-hosted studio |
|---|---|
| Projects, the wizard, actors, versioned scripts with emotions, the benchmark lab and export pages, light and dark themes | Cloud models: they need an API key kept on a server. Settings and the wizard say so. |
| Rendering in the browser with **Kokoro voice + captions**: the same voices and picture as the local renderer, played, seeked and downloaded as MP4 | ComfyUI and other model servers: a web page cannot reach servers on your machine |
| Data that survives reloads and new deploys (migrations already applied are recorded in `troupe_static_migrations`) | Provider accounts (Settings shows why instead of the form) |
| **Reset demo data** in Settings, also offered when the studio cannot load | Background render checks: a render runs in the tab that launched it |
| The **script chat**, with a small model run by [WebLLM](https://github.com/mlc-ai/web-llm) on the GPU (880 MB, once per browser; needs WebGPU), then Apply & relaunch in the tab ([SCRIPT-CHAT.md](SCRIPT-CHAT.md)) | Ollama and Claude for the chat: no server to keep a key or reach your machine |

## Rendering in the browser

The demo's own model, **Kokoro voice + captions**, renders in the tab that
launches it (`site/src/render/`):

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
when the lockfile or the renderer settings change. Locally,
`RENDER_ARGS="--disable-gpu --disable-features=WebGPU"` forces the CPU path on
a machine with a GPU.

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
  `src/app/_components/edition.tsx` tells the pages they run in the demo.
- `site/src/db/`: PGlite in a worker (`idb://troupe`), shared by every open tab;
  the Drizzle migrations are bundled with `import.meta.glob`.
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

`.github/workflows/pages.yml` builds the site on every pull request and push
to `main`. Deploying to GitHub Pages is manual for now: run the workflow from
the Actions tab (enable Pages with "GitHub Actions" as the source first).
