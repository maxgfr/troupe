# Checking real providers

The test suite replays responses recorded from each provider
(`src/test/provider-fixtures.ts`) and never spends money. Two commands make
real calls instead, with your own keys.

## Free key checks

Settings → Provider accounts → **Test**, or from a terminal:

```bash
troupe doctor --providers
```

Each check costs nothing and generates nothing:

| Account | Request | Tells apart |
|---|---|---|
| Google AI | the Veo model's metadata (`GET /v1beta/models/<id>`) | unknown key, key without access to the Gemini API, unsupported region, billing, quota, model not offered |
| fal.ai | the endpoint's price (`GET api.fal.ai/v1/models/pricing`), shown in the result | unknown key, key without access, rate limit |
| Anthropic | the Claude model (`GET /v1/models/<id>`) | unknown key, no permission, unknown model, rate limit |

A key that passes can still be refused at launch for billing (Veo needs a paid
Gemini API project; fal.ai needs a balance): the launch then says so in the
same words.

## One real job per provider

```bash
pnpm verify:live          # free checks and free jobs, and the plan with its cost
pnpm verify:live --yes    # also run the paid jobs in the plan
pnpm verify:live --yes --only fal,anthropic --output ./live
```

For every provider configured in the environment, `pnpm verify:live` runs the
free check, then one job through Troupe's own adapters at the cheapest
settings the provider offers: submit, poll, download, `ffprobe`. It prints the
plan and its estimated cost first, never prints a key, and skips a provider
with nothing configured, saying which variable it reads. Videos land in
`./troupe-live` (`--output`).

Without `--yes` it runs the free checks and the **free jobs**: an Ollama
answer, a ComfyUI render on your GPU, a small MP4 uploaded to Supabase Storage,
read back and deleted, and a deployed studio's health check and job check (a
`POST` that may advance renders already running there). The jobs Google,
fal.ai and Anthropic bill run only with `--yes`, even for a model without a
known price ("price unknown" in the plan).

| Provider | Reads | Job | Estimate |
|---|---|---|---|
| Google | `GEMINI_API_KEY`, `GOOGLE_API_KEY` or `GOOGLE_GENAI_API_KEY`; `TROUPE_LIVE_VEO_MODEL` (default `veo-3.1-lite`) | one 4 s 720p 9:16 clip | $0.20 (Veo 3.1 Fast: $0.40) |
| fal.ai | `FAL_KEY`; `TROUPE_LIVE_FAL_MODEL` (default `seedance-1.5-pro`) | one 4 s 480p 9:16 clip, silent | $0.05 (Kling 3.0, 3 s silent: $0.25) |
| Anthropic | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | one script chat answer | about $0.03–0.10 (Claude Opus 5.5; its adaptive thinking is billed as output, so the length varies) |
| Ollama | `OLLAMA_URL`, `OLLAMA_MODEL` | one script chat answer | free |
| ComfyUI | `TROUPE_LIVE_COMFYUI_URL` (or `COMFYUI_URL`), `TROUPE_LIVE_COMFYUI_TEMPLATE` (default `ltxv-2b-distilled`), `TROUPE_LIVE_COMFYUI_TOKEN` | the template's shortest clip | free |
| Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, optionally `DATABASE_URL` | a small MP4 up, back through a signed URL, deleted; migrations and row level security | free |
| A deployed studio | `TROUPE_LIVE_STUDIO_URL`, `RECONCILE_SECRET` | `/api/health`, then the job check | free |

Prices are the providers' list prices of 2026-10-05 for the settings sent
(`src/modules/models/list-price.ts`, shared with `troupe doctor --live`); your
bill is what the provider charges. `TROUPE_LIVE_VEO_MODEL` and
`TROUPE_LIVE_FAL_MODEL` must name a built-in of that provider; anything else
stops the run with the list of choices.

`troupe doctor --live` does the same through a running studio instead: one
render per model that can launch, at its cheapest settings, through the
studio's API, background checks and storage, in a new project; then it
downloads each video, runs `ffprobe` on it and asks the script chat once. It
shows the plan and its cost and launches only with `--yes`; `--model` picks
models.

Neither runs in CI, which has no keys.

## What has been run

On 2026-10-05, on an Apple M5 with 16 GB, with no Google, fal.ai or Anthropic
key available: the free checks returned the expected refusals for invalid
Google and fal.ai keys (Settings → Test, against the live APIs), and
`pnpm verify:live --yes` and `troupe doctor --live --yes` ran their free jobs
for real: Ollama (`qwen3:4b`) proposed a script, ComfyUI rendered the
LTX-Video 2B template (H.264, 480×832, 2.04 s), and a local Supabase stored
and served the file. **No paid generation has been run** (Veo, Kling,
Seedance, Claude). To run them with your keys, for about $0.28–0.35 in all:

```bash
GEMINI_API_KEY=... FAL_KEY=... ANTHROPIC_API_KEY=... pnpm verify:live --yes
```
