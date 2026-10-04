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

These are UX gaps, not broken flows. They are left for the polish phase.

1. **Project status never moves past "scripting".** The schema has
   `generating`, `review` and `done`, but nothing writes them, so the
   dashboard shows "scripting" on a project with completed renders and an
   export. This needs a decision on what each status means.
2. **Launch length vs script length.** The script estimates about 6 s and the
   model offers 6 s, but Launch preselects 8 s (the model's default), while
   **Compare** picks 6 s for the same script.
3. **Export page.** The render picker shows the adapter family (`draft · http ·
   8s`) instead of the model name. After an export, **Download MP4** and the
   still-enabled **Create export** sit side by side with no gap.
4. **Platform names** are lowercase strings shown with CSS `capitalize`:
   "Tiktok", "Youtube", "Linkedin" in the wizard and the export presets.
5. **Settings sends you to Settings.** Cloud model rows say "Add a Google AI
   key in Settings." on the Settings page itself; they should point to
   Provider accounts below.
6. **Duplicate local model names** are accepted. Two "Example model" entries
   then look identical in the pickers and the benchmark cards.
7. **Benchmark video size.** 9:16 renders fill the card width (about 900 px
   tall), while the project timeline caps the player at 420 px.
8. **Relaunch stays offered** on a failed render after a successful relaunch,
   so the same render can be relaunched twice.
9. **Download names.** Every download is `troupe-video.mp4`; the project title,
   model or date would tell files apart.
10. **Script page dead end.** After saving, the only way forward is "← Back to
    the project"; there is no call to launch. Each emotion change saves a whole
    new version, so versions pile up quickly.
11. **Example server housekeeping.** Renders accumulate in the OS temp folder
    and finished jobs stay in memory. Fine for a demo, worth a sentence in
    `docs/LOCAL-MODELS.md`.
12. **Dangling reference.** `src/modules/export/server/disclosure.ts` cites
    `docs/market/2026-07-12/REPORT.md`, which is not in the repository. The
    module is pure, but it sits under `server/` and is imported by the client
    component `export-sections.tsx`, which a "no server code in the bundle"
    check keyed on `/server/` paths would flag.

## Notes for later phases

- Do not run `pnpm build` while `pnpm dev` is running from the same checkout:
  both write `.next/` and the dev server then answers 500 until it is
  restarted with a clean `.next/`.
- Installing a dependency while `pnpm dev` runs crashes Turbopack ("Next.js
  package not found"); restart the dev server afterwards.
- `@playwright/test` is now a dev dependency for the smoke tests that later
  phases add. Its browser is installed with `pnpm exec playwright install
  chromium`.
