## What changes


## How I checked it

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`
- [ ] The title and every commit are Conventional Commits (`feat: …`, `fix: …`; `pnpm lint:commits`)
- [ ] `SKIP_ENV_VALIDATION=1 pnpm build`
- [ ] The browser edition, if `site/` or shared code changed: `pnpm site:build && pnpm site:test`
- [ ] The renderer or the scene, if they changed: a render watched end to end (say which)
- [ ] The Docker stack, if images or Compose changed: `pnpm e2e:docker`
- [ ] Tried it in the browser (describe)
- [ ] Ran a real paid or local render (say which model) — only if you did

## Settings and licenses

- [ ] A new setting has its default, its check, a line in `.env.example` and a row in `docs/CUSTOMIZING.md`
- [ ] A new dependency or model weight has its license in `THIRD_PARTY_NOTICES.md`
