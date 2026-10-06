# Changelog

## 0.2.0 — 2026-10-06

First tagged release. The code went public on 2026-10-04 numbered 0.1.0,
which was never tagged nor published as images; everything since is here.

### Added

- The local renderer (`renderer/`, `pnpm renderer`, and the stack's
  `renderer` service): a server that speaks the HTTP contract, voices each
  line with Kokoro, draws the actor card with their pictures and word-by-word
  captions, and encodes an MP4 with ffmpeg, on the CPU, as long as the
  script. The stack adds it as the default model on first start
  ([docs/LOCAL-MODELS.md](docs/LOCAL-MODELS.md#local-renderer)).
- The renderer's AI video mode, opt-in (`pnpm renderer:ltx`, or the `ltx`
  Compose profile on an NVIDIA GPU): LTX-Video 2B distilled generates a clip
  of the actor, laid under the same voice and captions. Its weights are under
  the LTXV Open Weights License, stated in
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- Every setting in one place, [docs/CUSTOMIZING.md](docs/CUSTOMIZING.md),
  which the test suite checks against the code, `.env.example` and
  `docker-compose.yml`. New settings: one hue and another font for the
  video's card and captions (`SCENE_HUE`, `SCENE_FONT_FILE`, and
  `VITE_SCENE_HUE`, `VITE_SCENE_FONT_URL` for the browser edition), and
  `ANTHROPIC_BASE_URL` for a gateway in front of Claude. The stack now passes
  `GOOGLE_API_KEY`, `ANTHROPIC_BASE_URL`, `TROUPE_CHAT_ANTHROPIC_FALLBACK`,
  `TROUPE_ACTOR_PORTRAITS_URL` and `TROUPE_TRANSCRIBE_TOKEN` on to the
  studio.
- The GNU GPL parts (eSpeak NG inside kokoro-js, the GNU libraries in
  yt-dlp's build) are stated plainly in the README and
  THIRD_PARTY_NOTICES.md, with PGlite's license added.
- One look and one map for the whole product ([docs/PRODUCT-MAP.md](docs/PRODUCT-MAP.md)):
  Projects shows each project as a poster of its newest video (playing
  while hovered), every project page opens on its actor with Video, Script
  and Export tabs, the sections move to a tab bar on phones, New project and
  Settings sit in the bar, keyboard shortcuts (`n`, `g` then a letter, `/`,
  `?`), shared buttons, chips, fields and icons on every screen, a stage
  light in the actor's hue, and the landing page lit the same way. The
  Benchmark lab is now Compare.

- The inspiration library ([docs/LIBRARY.md](docs/LIBRARY.md)): save files,
  pasted text and links (yt-dlp for video platforms, articles kept as text);
  your own models transcribe them (faster-whisper on the renderer, Whisper in
  the browser edition), take a picture after each cut and describe it
  (Ollama vision), find the hook, structure, pace, tone and tags, and index
  them for search by meaning. A library chat answers with citations to items
  and moments; idea cards ("10 ideas in this style", a hook remix, a script
  for an actor, a long item cut into short scripts) become a project with its
  script in one click; items marked as your own shape everything written "in
  your voice". `troupe library add|list|show|search|chat|ideas`, `doctor`
  checks, the Claude skill, the Docker stack (models pulled after the chat
  model) and both editions.

- Model catalog: Veo 3.1 Fast, Kling 3.0 and Seedance 1.5 Pro described by their
  capabilities (formats, resolutions, lengths, audio, tried languages). Each
  model can be turned off, given defaults, a price per second and a time limit;
  one is the studio default.
- Local models: ComfyUI (bundled LTX-2 and Wan 2.2 TI2V 5B workflows, or your
  own API export) and any HTTP server that follows the documented contract.
- Settings to manage provider accounts, test keys and connections, and add,
  edit or archive local models.
- Estimated cost per render, marked "est.".
- Script chat on the project page: proposals shown against the current
  version, Apply and Apply & relaunch, with Ollama, Claude or (in the
  browser edition) WebLLM. Settings → Script chat sets the provider, models, house style
  and word budget.
- Rename and delete projects, restore earlier script versions, relaunch failed
  renders; Compare opens the new comparison.
- One-command Docker install: migrations and job checks run inside the app,
  `/api/health`, optional ComfyUI GPU service, multi-arch images on GHCR.
- Render progress on the project page: the progress a model reports while a
  job runs is stored with the render (migration 0019) and fills its bar.
- HTTP contract v1 gains an optional `captions: "burned"` on a finished job:
  the video already shows the captions, so the player keeps its own track
  off. The local renderer and the in-browser renderer send it.
- Downloads are named after the project, the model and the time.
- The browser edition: the studio as a static site that runs entirely in the
  browser, renders with Kokoro voices and captions, and keeps its data on the
  device. Settings → Your data shows the storage used, asks the browser to
  keep it, exports and imports a backup of everything (a versioned tar
  archive) and deletes it all.
- A landing page in front of the browser edition (`/troupe/`): the
  presentation video, how a project goes from script to MP4 (each step jumps
  the video to it), the 30 actors, the two editions side by side, the models
  with where they run and what has been tried, the limits and the license
  notes. `VITE_SITE_URL` and `VITE_REPO_URL` point its canonical and social
  links and its docs links at a fork.
  The cast grid uses 160 and 320 px copies of the front pictures
  (`scripts/actors/thumbnails.sh`).
- `troupe`, a command-line client for a running studio (`cli/`): sign-in
  with the access code into per-profile config (`~/.config/troupe`, 0600),
  `doctor`, models and provider keys, actors, projects, scripts in a
  `[emotion] line` file format, the script chat, launching and watching
  renders, exports and downloads; `--json` everywhere and documented exit
  statuses ([docs/CLI.md](docs/CLI.md)). It speaks https to other machines
  (plain http only on this machine, or with `--insecure`). For it, the API
  gains `export.list`, and `script.paste` takes an emotion per line.
- A Claude Code skill and plugin marketplace (`skills/troupe`,
  `.claude-plugin/`) that runs a project end to end through the CLI,
  reviewing each render with ffprobe and extracted frames
  ([docs/CLAUDE-SKILL.md](docs/CLAUDE-SKILL.md)).
- A one-minute presentation video, recorded from the real browser edition by
  `scripts/tour/record.ts` (Playwright, headed Chrome) and cut by
  `scripts/tour/edit.sh` (ffmpeg): `pnpm tour:record`, then `pnpm tour:edit`.
- The whole product in one `docker compose up -d --wait`, with nothing to set
  first: next to the studio and its database, the local renderer, an Ollama
  server for the script chat (`troupe-ollama`, the official build without its
  GPU libraries; it downloads `OLLAMA_MODEL` on first start) and the browser
  edition behind nginx (`web`, on port 3101, base path `TROUPE_WEB_BASE`).
  The database password is generated on first start, and the studio adds the
  stack's renderer as its default video model, once
  (`TROUPE_AUTOCONFIGURE`). Profiles add the CLI (`docker compose run --rm cli
  doctor`, signed in with the studio's access code), ComfyUI and the
  renderer's AI video mode on an NVIDIA GPU (`ltx`, or `ltx-cpu`);
  `docker-compose.gpu.yml` runs the chat on an NVIDIA GPU. Every image is
  published on GHCR for amd64 and arm64
  ([docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)).
- `pnpm e2e:docker`: builds the images, starts the stack under its own
  Compose project and runs the studio's whole flow, the CLI and the browser
  edition against it in Chromium, then deletes it; CI runs it on every push.
- Veo 3.1 Lite, Google's cheapest Veo, and verified prices per second for
  every built-in model. `TROUPE_MODEL_IDS` points a built-in at a newer
  upstream id without a release; `GEMINI_API_KEY` and `GOOGLE_API_KEY` are
  read for Google too.
- Free key checks: Settings → Test, `troupe keys test` and
  `troupe doctor --providers` read the Veo model, the fal endpoint's price or
  the Claude model, and say whether the key is unknown, lacks access, is in an
  unsupported region, or has run out of quota or balance. Launches give the
  same reasons.
- `pnpm verify:live` and `troupe doctor --live`: one real job per configured
  provider at its cheapest settings, downloaded and checked with ffprobe,
  priced first and run only with `--yes` ([docs/LIVE-CHECKS.md](docs/LIVE-CHECKS.md)).
- A ComfyUI workflow for LTX-Video 2B distilled that renders on a 16 GB Mac,
  offered first.

### Changed

- Migration 0021 turns row level security on for the user table, the last
  one Supabase's Data API could reach with the anon key.
- On Supabase, use the session pooler: the transaction pooler stalled for good
  on the studio's pipelined queries in local testing (Supavisor 2.9.13; the
  hosted pooler not verified), and the studio warns when it is configured.
  Idle database connections close after 20 s.
- A finished video that cannot be saved says why in the server log;
  `FFPROBE_PATH` chooses the ffprobe that checks it.

- Launching a script longer than its clip is refused as a bad request with
  its reason, instead of an internal error.

- Saved API keys are encrypted at rest (existing plaintext keys are converted
  on first read).
- Production always requires an access code; one is generated on first start
  when none is set. Works behind HTTPS reverse proxies.
- Pickers offer only what the chosen model accepts; errors read as sentences.
- A render is a draft until it is exported; the exported one is final.
  Migration 0019 rewrites existing renders to match, and cannot be undone:
  every render without an export becomes a draft (comparison renders were
  stored as final before), every exported one final.
- The dashboard shows each project's stage (Script, Rendering, To review,
  Exported), worked out from its renders and exports.
- A failed render can be relaunched once (migration 0020 enforces it).
- Launch and Compare start on the model's default length when the script fits
  it, else on the shortest clip that holds the script.
- Videos rendered in the browser no longer play the voice 44 ms behind the
  picture: the AAC encoder's leading silence is trimmed by an edit list.

### Removed

- Unused SaaS-era code: Sora 2 and Omni Flash adapters, webhooks, billing,
  dubbing, photo and video remakes, custom actors, team review.
- Separate `migrate` and `worker` Docker services.
- `POSTGRES_PASSWORD` is no longer required (an existing database keeps
  using it), and the `renderer` Compose profile: the renderer runs by default.
