# Static site

`site/` builds the studio as a static site for GitHub Pages: the landing page
at `/troupe/` and the app at `/troupe/app/`. There is no server. The pages
from `src/app/(app)` and the full tRPC router run in the browser, on Postgres
compiled to WebAssembly ([PGlite](https://pglite.dev)) and kept in IndexedDB.

```bash
pnpm site:dev       # http://localhost:5173/troupe/
pnpm site:build     # site/dist, ready for GitHub Pages
pnpm site:preview   # serves site/dist at http://localhost:4173/troupe/, deep links as Pages does
pnpm site:test      # Playwright smoke test against the preview (run site:build first)
```

The first visit downloads about 20 MB (Postgres and its data files), then
starts in a few seconds.

## What works and what does not

| Works in the demo | Needs the self-hosted studio |
|---|---|
| Projects, the wizard, actors, versioned scripts with emotions, the benchmark lab and export pages, light and dark themes | Rendering video. No model can launch yet: cloud models need an API key kept on a server, and a web page cannot reach ComfyUI or other servers on your machine. Settings and the launch panel say so. |
| Data that survives reloads and new deploys (migrations already applied are recorded in `troupe_static_migrations`) | Provider accounts and local models (Settings shows why instead of the forms) |
| **Reset demo data** in Settings, also offered when the studio cannot load | Background render checks |

## How it is put together

- `site/vite.config.ts`: Vite with `base: "/troupe/"`, `~` mapped to `src/`, and
  `troupe:server-guard`, a plugin that fails the build when code from `src/` or
  `site/` imports a Node built-in, a server package (`postgres`, Supabase,
  `server-only`…) or a Next module other than `next/link` and
  `next/navigation`.
- `site/src/shims/`: `next/link` and `next/navigation` on top of react-router,
  and a stand-in for `src/server/settings/secrets.ts` that refuses to store
  secrets. The shims check their signatures against Next's and the real
  module's types, so `pnpm typecheck` catches drift.
- The rest goes through seams in `src/`: the tRPC context takes the database,
  the media store and the machine description (`createTRPCContext`), and
  `src/app/_components/edition.tsx` tells the pages they run in the demo.
- `site/src/db/`: PGlite in a worker (`idb://troupe`), shared by every open tab;
  the Drizzle migrations are bundled with `import.meta.glob`.
- `site/public/sw.js`: a service worker that serves renders stored in
  IndexedDB at `/troupe/app/media/<id>`, with byte ranges for seeking.
- `404.html` is a copy of the app, so a deep link such as
  `/troupe/app/projects/<id>` opens the right page.

## Publishing

`.github/workflows/pages.yml` builds the site on every pull request and push
to `main`. Deploying to GitHub Pages is manual for now: run the workflow from
the Actions tab (enable Pages with "GitHub Actions" as the source first).
