# Contributing

Thanks for helping. Troupe is a personal studio: changes that make the script →
video → download path more reliable, add models or make self-hosting easier are
the most welcome. Payments and multi-user administration are out of scope.

## Set up

Node.js 22+ (see `.nvmrc`), pnpm 10, Docker for PostgreSQL, and `ffprobe` from
FFmpeg. Follow the development steps in the [README](README.md#other-ways-to-run-it).

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
- Describe what changed and how you checked it. Mention live-provider testing
  only if you actually ran it.

Do not commit `.env`, API keys, generated videos, database dumps or the `data/`
folder.

By contributing you agree that your work is released under the MIT license and
to follow the [code of conduct](CODE_OF_CONDUCT.md).
