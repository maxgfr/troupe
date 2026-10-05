# Changelog

## 0.1.0 — unreleased

First public release.

### Added

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
- A one-minute presentation video, recorded from the real browser edition by
  `scripts/demo/record.ts` (Playwright, headed Chrome) and cut by
  `scripts/demo/edit.sh` (ffmpeg): `pnpm demo:record`, then `pnpm demo:edit`.

### Changed

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
