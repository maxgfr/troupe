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

Run on 2026-10-05 on the same machine. The static site now presents itself as
Troupe, running in the browser: no banner, "Needs the self-hosted studio" with a link to
SELF-HOSTING.md where a control would be, and Settings → **Your data**
(storage, persistence, backup export/import, **Delete all local data**).

| Run | Result |
|---|---|
| `pnpm site:test` | 5/5, including export → delete all local data → import, with the script read back, and no wording that sells the site short on the dashboard or Settings. |
| `pnpm site:test:render` (headed Chrome, fresh profile) | 3/3: the render, the interrupted render, then export → delete all local data → import, after which the first test's video plays again from the media service worker (720 px wide, playhead moving). `tar -tf` lists the backup. |
| Screens at 390 and 1280 px, light and dark | Landing, dashboard, wizard model step, project page, Settings (Your data, the backup confirmation, the delete confirmation, a refused file), not-found page. No console errors. |
| Self-hosted regression walk (`pnpm dev`, the example model) | Settings still shows **Your studio**, provider accounts and background checks, and the same wording; launch → video in 5 s, played 720×1280; timeline and export downloads both h264 720×1280 + AAC, 8.000 s; the dashboard row moved to **Exported**. No console errors or 5xx. |

Review fixes: a backup may only bring `video/mp4` or `video/webm` files, and
the media service worker sends any other stored type as a download
(`application/octet-stream`, `nosniff`); the smoke test stores an HTML file
and checks it. Backups from a newer build are refused before the
confirmation; foreign keys are checked again after a restore (a hand-damaged
backup is refused, nothing changed); the import no longer overwrites a file
before the database commits, always reloads once it has, and the studio
clears files no render refers to when it starts.

CI hotfix: on GitHub's runner the render test's "Delete all local data"
never reached the dashboard within its 60 s, and the page meanwhile said the
studio could not be initialized. Measured locally (headless Chromium, CPU
voices): the deletion took 20–28 s, 18 s of it seeding the actor library
again, one statement at a time (90 statements, each a PGlite worker round
trip that writes to IndexedDB), and queries already on their way read the
rebuilt tables before the seed. The library now seeds in at most 5
statements and checks itself in 2 (deletion to dashboard 38 s → 16 s,
database start on each page load 8.4 s → 2.2 s, `pnpm site:test` 1.5 → 0.75
min), queries caught by a rebuild are asked again afterwards, and the test
waits for each step the app takes (deletion, then start) and fails if the
studio ever looks broken in between.


## Final verification

Every user-facing feature, exercised in the running product on 2026-10-06
(Apple M5, 16 GB, macOS; Docker Desktop with 10 CPUs and 8 GB; Chrome 154
with WebGPU), from `a875d95` plus the fixes below.

- **Self-hosted studio**: the one-command stack built from this checkout,
  `docker compose -p troupe-verify up -d --wait` (studio on 3300, browser
  edition on 3301), with its default models: qwen3:4b for the chats,
  qwen3-embedding:0.6b and qwen3-vl:2b-instruct for the library, Kokoro q8 and
  Whisper base on the renderer. The Ollama volume was seeded from this Mac's
  Ollama cache (the same four models) instead of downloading 5 GB again, so
  the first-start download was not re-timed here (`pnpm e2e:docker` below
  covers the pulls from its cache).
- **Browser edition**: the stack's `web` service in headed Chrome on a
  private profile (WebGPU, GPU voices), plus a Chrome started without WebGPU.
- **CLI**: the native bundle (`cli/dist/troupe.mjs`) against the stack, and
  the stack's `cli` container.
- Playwright drove every page at 390 px and 1280 px, light and dark, with
  screenshots looked at; console errors and 5xx responses recorded. The
  scripts and screenshots stay out of the repository (the run's scratch
  folder); the names below are the screenshots' and logs'.

No key for a paid provider was available: paid renders and Claude answers
were not run. Their free key checks were run against the real APIs with keys
that are not real, which is what a mistyped key looks like.

### Self-hosted studio

| Feature | How it was verified | Result | Evidence |
|---|---|---|---|
| Access code | `/dashboard` without a cookie → `/access`; a wrong code → "This access code is incorrect." (401); the code from `docker compose logs app` → Projects | pass | `s-access-*`, `s-access-wrong-1280-dark` |
| Projects, empty | The cast, "about two minutes", the three steps, one New project | pass | `s-dashboard-empty-*` (4 variants) |
| Navigation and shortcuts | Top bar at 1280, bottom tab bar at 390; `?` lists the shortcuts, `g a` → Actors, `n` → New project; titles "Script · Cold brew mornings · Troupe" and so on | pass | `s-g-shortcuts-*`, `walk.log` |
| Wizard | Platform → format and model (the stack's renderer preselected, "default"; cloud models say "Add a … key in Settings") → language → actor | pass | `s-flow-01…04` |
| Script, emotions, versions | Three lines saved as version 1; "excited" on line 1 saved and drawn as an excited face in the render; versions restored (CLI) | pass | `s-flow-07-script-saved`, `s-flow-frames` |
| Launch, progress, timeline, playback | Launch draft → video in 8.6 s; the bar fills while rendering; the player plays (720×1280, 8.92 s, no media error) | pass | `s-flow-09-launching`, `s-flow-10-rendered` |
| Downloads and export | Timeline and export page both save `cold-brew-mornings-local-renderer-2026-10-06-1926.mp4`: h264 720×1280 + AAC, 8.917 s; the export marks the render final, gives TikTok's AI-label rule, and the project moves to Exported | pass | `s-flow-12/13`, `s-flow-14-dashboard` |
| Script chat (Ollama) | Three requests on qwen3:4b: 21.7 s (model load), 6.9 s, 6.9 s; **Apply only** → version 2; the earlier proposal then says it was asked on version 1; **Apply & relaunch** (gold) → version 3 rendered in 8.6 s; phone bottom sheet opens and closes | pass | `s-chat-01…05`, `s-g-chat-sheet-390-*` |
| Renderer stopped | `docker compose stop renderer`: the launch fails at once with "Could not reach http://renderer:8078. Is the server running…" and **Relaunch**; Settings → Test says the same; restarted, Relaunch completed in 9.2 s and the failed row says "Relaunched" | pass | `s-fail-01…03` |
| Ollama stopped | The chat stops in 0.1 s with a reason, and Settings → Test says so; started again, "Ollama answers and has qwen3:4b." The advice was `ollama serve`, wrong for the stack's own service | fixed in `82c0600` | `s-fail-04`, `s-chattest-down/up` |
| Library: saving | An uploaded render and clip, a pasted text, a Wikipedia article and a YouTube link (yt-dlp) all read to **ready** (videos 98–135 s with transcript, pictures, vision, hook, structure; text 9–19 s; article 34 s) | pass | `s-lib-03…09` |
| Library: refused input | A binary and an HTML file → "This file is not one the library reads…"; an empty file → "The file is empty."; a link to the server itself is refused | pass | `s-bad-*` |
| Library: search, ask, ideas | `/` focuses the search; "making coffee in the fridge overnight" → 20 passages by meaning; the library chat answered in 9.4 s citing the clip at 0:00; 10 ideas in 46.9 s; one became a project and rendered | pass | `s-lib-10…15` |
| Actors | 30 actors with picture, voice and style; gender filters | pass | `s-actors-*`, `s-g-*` |
| Compare | With the AI video mode's model (5 s clips) listed among three, no comparison was offered at all | fixed in `c914a34` | — |
| Compare, after the fix | Compare 2 models → both render side by side; rated 5 and 4; **Adopt for project** (gold) | pass | `s-cmp-01…05` |
| Settings | Theme saved per device (light after a reload); default model; launch defaults and limits; background checks ("Last run 23s ago") | pass | `s-settings-*`, `s-set-01`, `s-set-09` |
| Provider accounts | No key: Test says "No key is configured for this account." A key that is not real: Google answers "Google rejected this API key: it is mistyped, deleted or expired…" (a real free request). Removing the key left that verdict under "Not configured" | fixed in `24653ca` | `s-set-02…04` |
| Paid generation (Veo, Kling, Seedance) and the Claude chat | — | not run (no keys) | — |
| Local models | ComfyUI not running → "Could not reach ComfyUI at http://host.docker.internal:8188…"; an HTTP model on an unreachable address is refused by the CLI unless `--skip-test` | pass | `s-set-08` |
| AI video mode (LTX), opt-in | The stack's renderer answers `/ltx/health` with 503 "The AI video mode is off on this renderer. Start it with pnpm renderer:ltx (see docs/LOCAL-MODELS.md)"; Settings → Test shows it; `troupe doctor` warns; nothing is installed or downloaded. The UI still lets the model be added (status "Ready", the test result beside it), as for any model whose server is not up yet | pass (gated) | `s-set-06/07`, `cli-walk.log` |
| AI video mode, a real clip | 25 GB of weights and minutes per clip; rendered end to end earlier (LOCAL-MODELS.md, "Measured on an Apple M5") | not run (heavy) | — |
| Not-found page | An unknown address showed Next's bare "404 · This page could not be found."; now the studio's page in its shell, titled "Page not found · Troupe" | fixed in `0634c1b`, `c5b0933` | `s-notfound-*` (before), `s-g3-notfound-*` |
| A project that does not exist | Its tabs over "The project failed to load: project not found", with no way out; now the not-found page with **Back to your projects** | fixed in `0cd74ab` | `s-g-project-missing-*` (before), `s-g3-project-missing-*` |

### Browser edition

| Feature | How it was verified | Result | Evidence |
|---|---|---|---|
| Landing page | Headline, the two editions, steps that jump to chapters, cast, models, limits; **Open Troupe in your browser** opens the studio | pass | `w-landing-*`, `w-g-landing-*` |
| Tour video | Plays from its poster (1920×1080). It still showed the studio before the navigation was unified (Dashboard · Actors · Benchmark, "My studio", no tabs, an old chat warning) | fixed in `02dbbe6` (recorded again with `pnpm tour:record`, cut with `pnpm tour:edit`: 53.9 s, both files under 7.5 MB) | `tour-grid` (before), `newtour-grid` |
| Wizard | Cloud models say "Needs the self-hosted studio" (4 times) | pass | `w-wizard-format` |
| In-browser render | First render 80.4 s including the 326 MB voice download; live progress; plays and seeks (720×1280, 9.79 s); timeline and export downloads `browser-cold-brew-kokoro-voice-captions-2026-10-06-1947.mp4`, h264 + AAC | pass | `w-rendering`, `w-rendered`, `w-exported`, `w-frame-*` |
| Persistence, deep links | Reload keeps the render; a new tab opened straight on `/troupe/app/projects/<id>/script` shows version 1 | pass | `w10.out` |
| WebLLM script chat | First answer 197.6 s (the 880 MB model download), then 4.9 s; Apply only; Apply & relaunch. The model put emoji in the lines ("Grab a cold brew today! ☕"), which the voice cannot say | fixed in `167651a`, `1185283` | `w-chat-1…2` |
| A render cut off | Chrome closed mid-render: the row says "The tab rendering this video was closed before it finished. Relaunch it."; Relaunch completed | pass | `w-chat-relaunched-done`, `w-relaunch-done` |
| WebGPU gate | Chrome without WebGPU: "The chat runs on a GPU through WebGPU, and this browser offered none…"; the rest works | pass | `w-nogpu-video`, `w-nogpu-library` |
| Library | A pasted link: "Links need the self-hosted studio."; a text and the clip read in 59.7 s in the tab; the item page says what was skipped (no vision model) | pass | `w-library-*`, `w-g-library-item-*` |
| Library: refused input | Binary, HTML and empty files → "This file is not one the library reads…" | pass | `w-bad-*` |
| Your data | Storage figures; **Export data** → `troupe-backup-2026-10-06-2005.tar` (2.7 MB); **Delete all local data** → empty studio; **Import data…** names what the file holds, then the project and its render come back and play | pass | `w-settings`, `w-delete-confirm`, `w-import-confirm`, `w-after-import` |
| Offline | Loaded, then offline: opening a project hung on skeletons, since React Query pauses calls while offline though everything here is local. Now the project opens in 50 ms, its render plays and an emotion is saved. (Reloading offline still needs the network: there is no offline shell, and the docs promise none.) | fixed in `3131fa0` | `w-offline-navigate` (before), `w-offline-project`, `w-offline-script` |
| Not-found, missing project | "Page not found · Troupe" with Back to your projects, in both cases | pass | `w-g-notfound-*`, `w-g-project-missing-*` |
| Every page in four variants | Landing, Projects, Video, Script, Export, wizard, Library, item, Actors, Compare, Settings, not-found at 390/1280, light/dark | pass | `w-g-*` |

### CLI and Claude skill

| Feature | How it was verified | Result | Evidence |
|---|---|---|---|
| Every command, native | 63 runs against the stack: `login` (wrong code exit 3, then `--code-stdin`), `whoami`, unreachable studio (exit 4), plain http to another host refused (exit 2), `doctor`, `doctor --providers` (accounts `skip`), `doctor --live` (plan, exit 2 without `--yes`), `models list/test/default/templates/add`, `keys list/set/test/clear` (a fake fal key: "fal.ai rejected this API key…"), `actors`, `projects create/list/show/use/delete` (refused without `--yes`), `script set/show/--text/--json/versions/restore`, `chat send/history/apply/apply-and-launch --watch`, `render launch` (too long for 4 s → `SCRIPT_TOO_LONG`) `--watch/list/status/relaunch`, `download` (twice → `FILE_EXISTS`), `export create` (refused without `--confirm-watched`) and `list`, `library list/search/chat/ideas/add -`, `logout`. MP4s h264 720×1280 + AAC 11.29 s | pass | `cli-walk.log` |
| The `cli` container | `docker compose run --rm cli whoami`, `doctor`, `projects list`, `--json render list`, `download`, `library list`, signed in from the shared access code | pass | `cli-docker.log` |
| Claude skill | `skills/troupe/SKILL.md` followed step by step in zsh: check (missing `troupe`, doctor `fail studio`, sign-in), cast, script within the word budget, a too-long launch refused, render `--watch --timeout 500`, the review block verbatim (ffprobe and three frames, looked at), chat iteration, restore, export with its disclosure, then the library loop (save `--mine`, show, search, item chat with a citation, a remix, an idea made a project and rendered). `claude plugin validate` passes for the marketplace and the plugin | pass | `skill-walk.log`, `skill-frames` |
| Real-API checks | `pnpm verify:live` with no keys: paid jobs skipped with the variable each needs; an unreachable Ollama fails with its reason | pass (paid: not run, no keys) | `verify-live.log` |

### Design passes

`impeccable` (critique, single context: this task runs without sub-agents)
and `make-interfaces-feel-better` (quick) on the only new screen, the
studio's not-found page, which reuses `PageHeader`, `EmptyState` and one
primary `ButtonLink`: one cobalt action, the empty-state surface, the
studio's shell and tab bar, titles at 32/28 px, readable in both themes and
at 390 px; the detector found nothing. No change was needed. The other
fixes change behaviour, not layout.

### Gates

On the final tip: `pnpm lint` (522 files, one existing warning), `pnpm
typecheck`, `pnpm test` (148 files, 938 tests), `SKIP_ENV_VALIDATION=1 pnpm
build`, `pnpm site:build` and `pnpm site:test` (11 passed) all pass.
`E2E_PROJECT=troupe-e2e-t9 pnpm e2e:docker` on `1185283` (the code this
section describes), with a private `RENDER_PROFILE`: images, studio, CLI,
library, stack, browser edition and its in-browser renders, 28 passed in
5.7 min; the stack and its volumes were removed afterwards.
