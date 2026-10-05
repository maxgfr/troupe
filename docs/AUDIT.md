# Baseline audit

A check that the release (`e7fdbaa`) builds, runs and renders end to end before
any new work lands on it. Run on 2026-10-04.

Machine: Apple M5, 16 GB, macOS. Node 24.19.0, pnpm 10.33.0, Docker 29.8.1
(Docker Desktop, Compose v5.5.1), FFmpeg 9.0.2. No ComfyUI or Ollama.

## Summary

| Check | Result |
|---|---|
| `pnpm lint`, `pnpm typecheck`, `pnpm test`, `SKIP_ENV_VALIDATION=1 pnpm build` | Pass (312 tests before, 322 after this audit) |
| `docker compose up -d --build`: health, access code, restart, recreate | Pass |
| Full flow under `pnpm dev` with the example model server | Pass |
| Full flow in the Docker image with the example model server on the host | Pass |
| Failure, relaunch and model comparison | Pass |

Two bugs fixed, one gap in test coverage closed, and the rest written down
under [Deferred to polish](#deferred-to-polish).

## Gates

```bash
pnpm install
pnpm lint                          # Checked 216 files, no issues
pnpm typecheck                     # clean
pnpm test                          # 66 files, 312 tests passed
SKIP_ENV_VALIDATION=1 pnpm build   # 16 routes compiled
```

After the fixes: 218 files linted, 67 test files, 322 tests, build green.

## Docker Compose

```bash
POSTGRES_PASSWORD=… docker compose -p troupe-audit up -d --build
```

- The image builds from the checkout, `db` turns healthy, then `app` turns
  healthy (Dockerfile `HEALTHCHECK`) in about 15 s.
- `GET /api/health` answers `200 {"ok":true}`.
- The log prints the generated access code. The README's
  `docker compose logs app | grep -A1 "access code"` finds it.
- Without the cookie, `/` and `/dashboard` redirect (307) to `/access` and
  tRPC answers 401. A wrong code gets 401; the right code sets the cookie and
  `/dashboard` and `/settings` then answer 200.
- `docker compose restart app`: healthy again, same code, and the old cookie
  still works.
- `docker compose down` then `up -d`: the project, the local model, the
  completed render, `access-code` and `secret.key` are all still there.

## End to end

Script: a Playwright run against the real app (kept out of the repo,
screenshots in a scratch folder). It walks Settings → add a local model →
new project wizard → script → launch → timeline → playback → export →
download, and records browser console errors and 5xx responses.

### `pnpm dev`

```bash
docker run -d --name troupe-db -e POSTGRES_PASSWORD=password -e POSTGRES_DB=troupe -p 127.0.0.1:5432:5432 postgres:16-alpine
PORT=8077 HOST=127.0.0.1 node examples/http-model/server.mjs
DATABASE_URL=postgresql://postgres:password@127.0.0.1:5432/troupe TROUPE_INPROCESS_WORKER=1 pnpm dev
```

1. Migrations ran on start and the in-process worker started (every 30 s).
2. Settings → Add a local model → HTTP endpoint, `http://127.0.0.1:8077`,
   lengths 4/6/8 s, audio on request. **Test** reported "reachable and speaks
   contract 1"; **Add model** listed it as Ready, and the automatic default picked it.
3. Wizard: TikTok, 9:16, EN, first actor → redirected to the script page.
4. Script: three lines saved as version 1; choosing "excited" on line 1
   saved version 2 and persisted.
5. Project page: Launch draft on the example model (8 s, 720p, audio). The
   render completed after about 21 s, which is one worker cycle.
6. Playback: the `<video>` played (720×1280, 8 s, a captions track, no media
   error). `/api/media/…` answered a range request with
   `206 bytes 0-99/2833420`.
7. Timeline **Download MP4** and the export page (TikTok preset, confirmation,
   **Create export** → **Download MP4**) both saved an MP4. ffprobe on each:
   h264 720×1280 + AAC, 8.000 s.
8. No browser console errors and no 5xx responses during the run.

Also checked by hand:

- `http://localhost:3000` works as well as `127.0.0.1` and lets loopback
  through without a code, as the README says.
- Model server stopped → Launch draft fails at once with "Could not reach
  http://127.0.0.1:8077. Is the server running and reachable from Troupe?" and
  a **Relaunch** button. Server restarted → Relaunch completed in about 22 s.
- **Compare 2 models** opened `/benchmark?run=…`; both renders completed and
  played in about 26 s.

### Docker image

The same run against `http://127.0.0.1:3100` with the access code, the model
server on the host (`PORT=8078`) and the address
`http://host.docker.internal:8078`. Every step passed with the same results:
completed in about 20 s, MP4s h264 720×1280 + AAC 8 s, no console errors.
Docker Desktop also forwards `host.docker.internal` to services bound to the
host's `127.0.0.1` (checked with the dev model server on 8077).

## Fixes

Each one started from a failing test.

### The ComfyUI address ignored where Troupe runs

The add-model form always prefilled `http://host.docker.internal:8188`
(`add-local-model.tsx`). Under `pnpm dev` that host does not resolve, and
ComfyUI Desktop, the usual install on a Mac, listens on 8000, not 8188.

- `suggestedComfyUrl()` in `src/server/settings/urls.ts`: in a container
  (`/.dockerenv` or `/run/.containerenv`) → `http://host.docker.internal:8188`;
  otherwise `http://127.0.0.1:8000` on macOS and `http://127.0.0.1:8188`
  elsewhere.
- New query `settings.models.suggestedAddress`; the form takes the address as
  a prop and restores it when you switch back from HTTP endpoint to ComfyUI.
- The hint under the address field now names both ports.
  `docs/LOCAL-MODELS.md` and `docs/SELF-HOSTING.md` list ComfyUI Desktop.
- Tests: `urls.test.ts` (4 cases), `add-local-model.test.tsx` (prefill and
  restore), `local-models.test.ts` (the procedure answers an address the form
  accepts). Verified in the browser: `http://127.0.0.1:8000` under
  `pnpm dev` on the Mac, `http://host.docker.internal:8188` in the rebuilt
  image.

From inside a container Troupe cannot tell whether the host runs ComfyUI
Desktop (8000) or command-line ComfyUI (8188), so it keeps 8188 there. The hint
covers the other case.

### No test covered the example model server

`src/modules/generation/server/adapters/http-example-server.test.ts` starts
`examples/http-model/server.mjs` as a child process and drives it with
Troupe's own HTTP endpoint adapter:

- the connection check passes with the token and reports HTTP 401 without it;
- a 9:16 720p 2 s render with audio comes back as h264 720×1280 + AAC lasting
  2 s (ffprobe);
- a 16:9 480p render without audio has a single video stream at the size
  Troupe asked for;
- a missing field or invalid JSON gets 400, and an unknown job 404.

It needs ffmpeg on the PATH; CI already installs it before `pnpm test`. To
start on a free port the test runs the server with `PORT=0`, which showed that
the server printed the port it was configured with (`:0`) instead of the one
it bound. It now prints the bound port.

## Deferred to polish

These were UX gaps, not broken flows. Phase 7 fixed all of them; each line
says how.

1. **Project status never moves past "scripting".** *Fixed:* the dashboard
   works the stage out from the renders and exports (`src/modules/studio/stage.ts`,
   `listProjects` in `src/server/projects.ts`): Script (no finished video),
   Rendering (one queued or running), To review (a finished video), Exported.
2. **Launch length vs script length.** *Fixed:* Launch and **Compare** follow
   one rule: the model's default length (Settings → Launch defaults, the
   first model's for Compare) when the script fits it, else the shortest clip
   that holds the script.
3. **Export page.** *Fixed:* renders are named by model, real length and
   draft/final; one primary button at a time (**Create export**, then
   **Download MP4** in its place); the project's own platform is preselected.
4. **Platform names.** *Fixed:* TikTok, Instagram, YouTube, LinkedIn
   everywhere (`src/modules/studio/platforms.ts`), server messages included.
5. **Settings sends you to Settings.** *Fixed:* a cloud model without a key
   links to **Provider accounts** below, on the same page.
6. **Duplicate local model names.** *Fixed:* adding or renaming a model to a
   name another model has (any case) is refused with a sentence that says so.
7. **Benchmark video size.** *Fixed:* capped at 420 px tall like the project
   page.
8. **Relaunch stays offered.** *Fixed:* a relaunch records its failed render
   (`parentGenerationId`); the timeline shows "Relaunched" instead of the
   button and the server refuses a second relaunch.
9. **Download names.** *Fixed:* `<project>-<model>-<YYYY-MM-DD-HHmm>.mp4`
   from the timeline and the export page; the media route, the browser edition's
   service worker and Supabase signed URLs honour the name (`mediaDisposition`).
10. **Script page dead end.** *Fixed:* **Launch a render →** under the lines
    opens the project page on its launch panel; trying emotions retags the
    newest version in place until a render or the chat uses it.
11. **Example server housekeeping.** *Fixed:* `docs/LOCAL-MODELS.md` says the
    MP4s pile up in the temp folder and jobs stay in memory.
12. **Dangling reference.** *Fixed:* the disclosure matrix moved to
    `src/modules/export/disclosure.ts` (pure, outside `server/`) without the
    missing report reference.

## Notes for later phases

- Do not run `pnpm build` while `pnpm dev` is running from the same checkout:
  both write `.next/` and the dev server then answers 500 until it is
  restarted with a clean `.next/`.
- Installing a dependency while `pnpm dev` runs crashes Turbopack ("Next.js
  package not found"); restart the dev server afterwards.
- `@playwright/test` is now a dev dependency for the smoke tests that later
  phases add. Its browser is installed with `pnpm exec playwright install
  chromium`.

## Phase 2: local renderer

Run on 2026-10-04 on the same machine, with the Playwright walk above
(Settings → add the model → wizard → three-line script → launch → playback →
timeline download → export → download) and Kokoro q8 for the voices.

| Run | Address | Result |
|---|---|---|
| `pnpm renderer` + `pnpm dev` | `http://127.0.0.1:8078` | before `poll_every_s`: completed one worker cycle (21 s) after launch; the render itself took 3.6 s. Timeline and export MP4s: h264 720×1280 + AAC, 8.250 s, the length the renderer logged for the voiced script ("3 lines, 8.25 s of video"). No console errors or 5xx. |
| `docker compose --profile renderer up -d --build` | `http://renderer:8078` | Same walk against the image on port 3100 with the access code: completed in 20 s, h264 720×1280 + AAC, 7.667 s (the script voiced as 7.65 s, rounded to whole frames at 24 fps). No console errors or 5xx. |
| Regression, `pnpm dev` with the example model server | `http://127.0.0.1:8077` | Unchanged: completed in 21 s, h264 720×1280 + AAC, 8.000 s. |

- The connection check reported "Local renderer is reachable and speaks
  contract 1." in both setups.
- In the timeline player the app's own captions track (WebVTT from the
  script) sits on top of the captions drawn in the video, so the words show
  twice when captions are on.
- The renderer image is about 1.8 GB (Debian, ffmpeg, the ONNX runtime). pnpm
  installs the workspace root's dependencies with any filtered install, so
  the Dockerfile strips them from the root manifest before installing.
- Frames were extracted from each format (9:16, 1:1, 16:9) and reviewed for
  layout: the script's role and emotion tags were taken out of the picture,
  the actor card now hugs its content, the word being said sits on a pill,
  caption lines are balanced, and vertical captions keep clear of the
  platforms' right-hand button rail.

### Polling pace (`poll_every_s`)

The renderer and the example server now advertise `poll_every_s: 1` on
`/health`. Measured through the UI under `pnpm dev`, from the **Launch draft**
click to the completed row in the timeline, with a 3-line script (8.55 s of
video, rendered in 3.7–4.0 s):

| Model | Launch → clip |
|---|---|
| Added after **Test** (pace saved) | 6.2 s |
| Added without **Test** (no pace: first poll at 20 s) | 22.8 s |
| The same model after **Test** on its Settings row | 6.2 s |

## Phase 5: script chat

Run on 2026-10-05 on the same machine (Apple M5, 16 GB), Ollama 0.35.1 with
`qwen3:4b`, Chrome with WebGPU for the browser edition.

| Run | Result |
|---|---|
| `pnpm dev` + `pnpm renderer` + Ollama | Settings → Script chat → **Test**: "Ollama answers and has qwen3:4b." New project, three-line script, first render, then two requests: answers in 4–6 s, both valid on the first try. **Apply only** made version 2 (`origin chat`, the model's roles and emotions); **Apply & relaunch** made version 3 and rendered it on the local renderer in 4 s: h264 720×1280 + AAC, 7.5 s. Phone (390 px): the sheet opens from **Chat** and closes again. No console errors or 5xx. |
| `docker compose --profile renderer up -d --build`, Ollama on the Mac | The app reached `http://host.docker.internal:11434` (Docker Desktop) with no setting. Regression walk (renderer at `http://renderer:8078`): h264 + AAC, 8.375 s, timeline and export. Chat walk: same results, relaunch rendered in 8 s, 7.975 s MP4. No console errors or 5xx. |
| Browser edition, `pnpm site:test:chat` (headed Chrome) | Fresh profile: the first answer came 81–84 s after the request, the 880 MB download included; later ones in a few seconds. Apply, then Apply & relaunch rendered in the tab; the chat survives a reload; migration 0018 applied by the browser migrator on a database from the previous phase. |
| Browser edition without WebGPU (`--disable-features=WebGPU`) | The chat says it needs a GPU through WebGPU and keeps the request field closed; the rest of the studio works. |

- qwen3:4b follows the instructions well; Qwen2.5 1.5B (browser edition) changes what
  was asked most of the time but its one-line summaries are sometimes wrong
  about what it changed, and it tends to overshoot the word budget (the panel
  then shows the length in amber and relaunching picks a longer clip).
- Small models add Markdown emphasis and copied the prompt's own notation into
  the lines; lines are now cleaned to plain spoken text, and the current
  script is given to the model as JSON in the answer's own shape.
- The Anthropic provider was tested against a fake API server only; no key
  was available for a real call.

## Phase 7: product polish

Run on 2026-10-05 on the same machine, `pnpm dev` + `pnpm renderer`, with the
Playwright walk above, then the browser edition.

| Run | Result |
|---|---|
| Regression walk, local renderer | Launch → clip in 9.7 s. The timeline reads `draft · Renderer · 13.2 s` (the script asked for a 10 s clip; the renderer follows the voice); the player's captions track is off (`disabled`) because the renderer reports `captions: "burned"`. Timeline and export downloads are both `spring-drop-…-renderer-…-2026-10-05-1025.mp4`, h264 720×1280 + AAC, 13.17 s. The export marked the render final; the dashboard row moved to **Exported**. No console errors or 5xx. |
| Progress and relaunch, a test server that reports progress over 20 s and fails its first job | The bar filled 22 % → 44 % → 65 % → 86 % from the model's `progress`; after **Relaunch** the failed row says "Relaunched" and offers no second relaunch. Checked at 390 and 1280 px, light and dark. |
| Comparison of three local models | Players capped at 420 px; burned-in captions off, the test pattern's track on. |
| `pnpm site:test` | 4/4, including named downloads from the media service worker. |
| `pnpm site:test:render` | 2/2, warm and cold, after the encoder-delay fix below. |

- Phones: the top bar and the browser edition's banner (removed since) each
  hold one row at 390 px.
- A Postgres container in this run was killed once by the OS (exit 137,
  memory pressure on the 16 GB machine); restarting it kept the data.
- Renderer videos made before this phase have no record of their burned-in
  captions (nothing stored tells which HTTP model was the renderer), so their
  player track still starts on.

### Audio behind the picture in browser renders

`site:test:render` failed on some runs: the audio stream lasted 0.1003 s
longer than the video, over the test's 0.1 s bound. ffprobe on the file:
video 143 frames (5.958 s), AAC 284 frames of 1024 samples (6.059 s), and no
edit list. Encoding a pulse with Chrome's `AudioEncoder` (AAC, 48 kHz, macOS)
brought it back 2112 samples (44 ms) late with the first chunk stamped 0:
the encoder's priming, which WebCodecs does not report, so the MP4 kept it
and every browser render played its voice 44 ms behind the picture. The rest
of the gap was the last AAC frame's padding plus the video rounding to whole
frames, which is why runs passed or failed with the voice's exact length.

`site/src/render/encoder-delay.ts` now measures the delay once per codec
(encode a pulse, decode it, find it) and `encode.ts` stamps the audio that
much early, so mediabunny writes an edit list (media time 2112) that trims
the silence. On the same render: the voice starts 44 ms earlier, the audio
stream is 6.015 s for 5.958 s of video, and the test passed on two warm and
two cold origins. Opus measured 12 samples (its pre-skip is already in its
header). One cold run timed out in the 8-minute wait while the voice model
downloaded (6.3 min on the next cold run, 1.6 min earlier in the day).

## Task 7c: the browser edition

Run on 2026-10-05 on the same machine. The static site stopped calling itself
a demo: no banner, "Needs the self-hosted studio" with a link to
SELF-HOSTING.md where a control would be, and Settings → **Your data**
(storage, persistence, backup export/import, **Delete all local data**).

| Run | Result |
|---|---|
| `pnpm site:test` | 5/5, including export → delete all local data → import, with the script read back, and no "demo" text on the dashboard or Settings. |
| `pnpm site:test:render` (headed Chrome, fresh profile) | 3/3: the render, the interrupted render, then export → delete all local data → import, after which the first test's video plays again from the media service worker (720 px wide, playhead moving). `tar -tf` lists the backup. |
| Screens at 390 and 1280 px, light and dark | Landing, dashboard, wizard model step, project page, Settings (Your data, the backup confirmation, the delete confirmation, a refused file), not-found page. No console errors. |
| Self-hosted regression walk (`pnpm dev`, the example model) | Settings still shows **Your studio**, provider accounts and background checks, and no "demo"; launch → video in 5 s, played 720×1280; timeline and export downloads both h264 720×1280 + AAC, 8.000 s; the dashboard row moved to **Exported**. No console errors or 5xx. |

