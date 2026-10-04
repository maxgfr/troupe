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
- Rename and delete projects, restore earlier script versions, relaunch failed
  renders; Compare opens the new comparison.
- One-command Docker install: migrations and job checks run inside the app,
  `/api/health`, optional ComfyUI GPU service, multi-arch images on GHCR.

### Changed

- Saved API keys are encrypted at rest (existing plaintext keys are converted
  on first read).
- Production always requires an access code; one is generated on first start
  when none is set. Works behind HTTPS reverse proxies.
- Pickers offer only what the chosen model accepts; errors read as sentences.

### Removed

- Unused SaaS-era code: Sora 2 and Omni Flash adapters, webhooks, billing,
  dubbing, photo and video remakes, custom actors, team review.
- Separate `migrate` and `worker` Docker services.
