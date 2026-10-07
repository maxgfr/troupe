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
- Write each commit message, and the pull request's title, as a
  [Conventional Commit](#commit-messages): the type decides the next release.
- Describe what changed and how you checked it. Mention live-provider testing
  only if you actually ran it.

Do not commit `.env`, API keys, generated videos, database dumps or the `data/`
folder.

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/),
because releases are made from them: `type(scope): subject`, the scope
optional, the subject in the imperative and in lower case.

```text
feat: let actors play a voice sample
fix(renderer): keep long captions inside the frame
docs: explain the access code for the CLI container
```

| Type | For | Release |
|---|---|---|
| `feat` | something new people can use | minor (0.2.0 → 0.3.0) |
| `fix` | a bug fixed; also a runtime dependency or base image updated | patch (0.2.0 → 0.2.1) |
| `perf` | the same behavior, faster or lighter | patch |
| `revert` | a commit undone (`git revert` writes the message) | patch |
| any type with `!` (`feat!: …`), or a `BREAKING CHANGE:` footer | a change that breaks a setting, the HTTP contract, a CLI command or data people already have; the footer says what to do | major (the first one makes 1.0.0) |
| `docs`, `test`, `ci`, `chore`, `build`, `refactor`, `style` | everything else | none |

CI's `commits` job checks every commit a push or a pull request adds, and a
pull request's title, which a squash merge turns into the commit. Check a
branch before pushing it with `pnpm lint:commits`. Commits before v0.2.0 are
prose and are never checked or read.

## Releases

Releases are automatic: there is nothing to run, bump or tag by hand. On every
push to `main`, `.github/workflows/release.yml` runs
[semantic-release](https://semantic-release.gitbook.io/) (`.releaserc.json`)
on the commits since the last `v*` tag. When one of them calls for a release
(table above), it:

1. tags the commit `vX.Y.Z` and publishes a
   [GitHub Release](https://github.com/maxgfr/troupe/releases) whose notes
   are generated from the commits, with files attached by
   `scripts/release-assets.sh`: the CLI in one file
   (`troupe-cli-X.Y.Z.mjs`), the browser edition (`troupe-web-X.Y.Z.zip`,
   `site/dist` built for `/troupe/`) and their `SHA256SUMS`;
2. publishes the five images to GHCR for amd64 and arm64
   (`.github/workflows/images.yml`): `troupe`, `troupe-renderer`,
   `troupe-ollama`, `troupe-web` and `troupe-cli`, each tagged `X.Y.Z`,
   `X.Y`, `X` and `latest`.

Nothing is committed back to `main`: the commits there are signed, and CI's
would not be. So the version in `package.json`, `cli/package.json` and
`renderer/package.json` stays at 0.2.0, the last one set by hand, and a test
keeps the three in agreement. Builds get the released version as
`TROUPE_VERSION` instead, read through `scripts/release-version.mjs`: a build
argument (and environment variable) of every image, logged by the studio
(`troupe.started`) and the renderer on start, and the CLI bundle's
(`cli/build.mjs`), which `troupe --version` and its User-Agent report. A
build without it reports the package.json version. The Claude plugin has no
version: Claude Code then follows `main` commit by commit, where a version
would pin users until a commit changed it.

Releases continue from the `v0.2.0` tag; `release.yml` stops rather than
start over at 1.0.0 when no `v*` tag is behind the commit. CHANGELOG.md holds
the history up to 0.2.0; every release since is described in its GitHub
Release.

To publish the images again for a version that has its tag, run the images
workflow by hand ("Run workflow" with the version; untick `latest` for an
older one). Pushing a `v*` tag by hand publishes that tag's images too, but
makes no GitHub Release.

By contributing you agree that your work is released under the MIT license and
to follow the [code of conduct](CODE_OF_CONDUCT.md).
