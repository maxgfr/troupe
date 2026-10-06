# Contributing

Thanks for helping. Troupe is a personal studio: changes that make the script →
video → download path more reliable, add models or make self-hosting easier are
the most welcome. Payments and multi-user administration are out of scope.

## Set up

Node.js 22+ (see `.nvmrc`), pnpm 10 (`corepack enable`), Docker for
PostgreSQL and the stack, and FFmpeg (`ffmpeg` and `ffprobe`) on your PATH.
Then `pnpm install`.

## The parts, and how to run each

| Part | Where | Run it | Read |
|---|---|---|---|
| The studio | `src/` (Next.js, tRPC, Drizzle; domain logic in `src/modules/<module>`, [map](src/modules/README.md)) | `DATABASE_URL=… pnpm dev` ([README](README.md#from-source-for-development)) | [PRODUCT-MAP.md](docs/PRODUCT-MAP.md) |
| The scene | `src/modules/scene` (pure TypeScript: captions, actor card, voice casting, palette) | through either renderer | [LOCAL-MODELS.md](docs/LOCAL-MODELS.md#local-renderer) |
| The local renderer | `renderer/src` | `pnpm renderer` (port 8078) | [LOCAL-MODELS.md](docs/LOCAL-MODELS.md#local-renderer) |
| Its AI video mode | `renderer/ltx` (Python, uv) | `pnpm renderer:ltx:setup`, then `pnpm renderer:ltx` | [LOCAL-MODELS.md](docs/LOCAL-MODELS.md#ai-video-mode-ltx-video) |
| Its transcription | `renderer/whisper` (Python, uv) | `pnpm renderer:whisper:setup`, then `pnpm renderer:whisper` | [LIBRARY.md](docs/LIBRARY.md) |
| The browser edition and landing page | `site/` (Vite; the studio's pages with their server code on PGlite in the browser) | `pnpm site:dev`, or `pnpm site:build && pnpm site:preview` | [BROWSER-EDITION.md](docs/BROWSER-EDITION.md) |
| The script chat | `src/server/chat`, `src/modules/chat`, `site/src/chat` | Ollama with `qwen3:4b`, or `ANTHROPIC_API_KEY`; WebGPU in the browser | [SCRIPT-CHAT.md](docs/SCRIPT-CHAT.md) |
| The inspiration library | `src/modules/library`, `src/server/library`, `site/src/library` | with the studio | [LIBRARY.md](docs/LIBRARY.md) |
| The CLI | `cli/` | `pnpm --silent troupe <command>` | [CLI.md](docs/CLI.md) |
| The Claude Code skill | `skills/troupe`, `.claude-plugin/` | `/plugin marketplace add maxgfr/troupe` in Claude Code | [CLAUDE-SKILL.md](docs/CLAUDE-SKILL.md) |
| The Docker stack | `docker-compose*.yml`, `Dockerfile`, `*/Dockerfile`, `ollama/`, `scripts/docker` | `docker compose up -d --wait --build` | [SELF-HOSTING.md](docs/SELF-HOSTING.md) |
| Settings | `src/env.js`, `site/src/*/config.ts`, `renderer/src/main.ts` | | [CUSTOMIZING.md](docs/CUSTOMIZING.md) |

## Tests

| Command | What it covers | CI job |
|---|---|---|
| `pnpm lint` | Biome, and the wording check below | `build-test` |
| `pnpm typecheck` | TypeScript across the studio, site, renderer and CLI | `build-test` |
| `pnpm test` | Vitest: every module, the renderer's HTTP contract, the CLI, the site's parsers, every migration replayed in PGlite, the settings page against the code. No API key, no network. | `build-test` |
| `SKIP_ENV_VALIDATION=1 pnpm build` | The studio's production build | `build-test` |
| `pnpm site:build && pnpm site:test` | The browser edition in Chromium (Playwright) | `site-smoke` |
| `pnpm site:test:render`, `pnpm site:test:chat` | A real render in the browser (downloads Kokoro), the WebLLM chat (needs a GPU) | `site-smoke` (render only) |
| `pnpm e2e:docker` | Builds the images, starts the stack under its own Compose project and runs the studio, the library, the CLI and the browser edition against it | `docker-e2e` |
| `pnpm verify:live --yes` | One paid job per configured provider ([LIVE-CHECKS.md](docs/LIVE-CHECKS.md)); never in CI | none |

## Before opening a pull request

```bash
pnpm lint
pnpm typecheck
pnpm test
SKIP_ENV_VALIDATION=1 pnpm build
```

- Keep domain logic in `src/modules/<module>` and import other modules through
  their `index.ts` (see `src/modules/README.md`).
- Write the failing test first. Tests use simulated providers or local HTTP
  servers; never spend real API credits in the suite.
- A new model adapter declares its capabilities and validates every request
  with `validateRequest` before calling anything.
- A new setting gets a default, a check where it is read (`src/env.js`, the
  site's and the renderer's parsers), a line in `.env.example` (or
  `site/.env.example`) and a row in [docs/CUSTOMIZING.md](docs/CUSTOMIZING.md);
  `pnpm test` fails until it has them. A Docker setting also goes into
  `docker-compose.yml`.
- A new dependency or model weight gets its license in
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), with any restriction
  stated plainly.
- Schema changes: edit the Drizzle schema, run `pnpm db:generate`, read the SQL,
  and add a backfill when existing rows need one (see `drizzle/0016_*.sql`).
  Never use `drizzle-kit push`: legacy tables kept for existing installs are
  absent from the TypeScript schema, so it would offer to drop them.
- `pnpm lint` also runs `pnpm check:wording`: the static site is Troupe's
  browser edition and the video its presentation tour, so one word for a
  cut-down product is refused everywhere (`scripts/check-wording.ts` names it
  and the two files allowed to contain it).
- Changed `renderer/ltx/generate.py`? Also run its tests, which need the AI
  video mode's Python environment and so are not in `pnpm test`:
  `uv run --project renderer/ltx python -m unittest discover renderer/ltx`
  ([LOCAL-MODELS.md](docs/LOCAL-MODELS.md#set-it-up)).
- Interface changes follow [DESIGN.md](DESIGN.md).
- Describe what changed and how you checked it. Mention live-provider testing
  only if you actually ran it.

Do not commit `.env`, API keys, generated videos, database dumps or the `data/`
folder.

## Releases

The version is the same in `package.json`, `cli/package.json`,
`renderer/package.json` and the Claude plugin (a test checks it). A release
moves the CHANGELOG's entries under the version and date, then a `v<version>`
tag makes `.github/workflows/release.yml` publish the images to GHCR.

By contributing you agree that your work is released under the MIT license and
to follow the [code of conduct](CODE_OF_CONDUCT.md).
