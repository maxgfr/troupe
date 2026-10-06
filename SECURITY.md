# Security

Please report vulnerabilities privately through
[GitHub security advisories](https://github.com/maxgfr/troupe/security/advisories/new),
not in public issues. You should get an answer within a week.

Fixes go into the newest release (0.2.x) and `main`; there are no older
branches to patch.

## What Troupe protects

- **Access.** In production every page and every data or media request
  requires the access code's cookie, whatever the request's `Host` header
  says. Without `TROUPE_ACCESS_CODE` a code is generated on first start. After
  five wrong codes an address waits 15 minutes, and after 100 from all
  addresses everyone does; the address is X-Forwarded-For's last hop, not its
  first, which the client writes (`TROUPE_TRUSTED_PROXIES` behind several
  proxies, [docs/CUSTOMIZING.md](docs/CUSTOMIZING.md)). Requests from other origins
  are refused. Two routes are deliberately outside the code: `/api/health`
  (answers only `{ ok }`) and `/api/jobs/reconcile` (requires its own
  `RECONCILE_SECRET`, and refuses every call when that is unset).
- **Credentials.** Provider keys (Google, fal.ai, Anthropic) and local model
  tokens are encrypted with AES-256-GCM, bound to their database row, under
  `TROUPE_SECRET` or a key file in the data volume. They are never sent to the
  browser.
- **Outbound requests.** Cloud keys only go to their provider's API hosts.
  Local model URLs, the chat's Ollama address and the transcribing renderer
  may target your network but not link-local or cloud metadata addresses; their
  tokens and downloads stay on the model's own origin, without following
  redirects.
- **The inspiration library.** Links it fetches itself must resolve to public
  addresses, at every redirect; uploaded files are recognized by their bytes,
  and served with `nosniff` and a sandboxing CSP. yt-dlp's own requests are
  not checked that way: [docs/LIBRARY.md](docs/LIBRARY.md#security) says how
  to fence them (`TROUPE_YTDLP_PROXY`) or turn them off.
- **Downloads.** Videos are size-capped and checked with ffprobe before they are
  stored.
- **The Docker stack.** Every service but `db` and the third-party `comfyui`
  runs as an unprivileged user; only the studio and the browser edition get a
  port, on `127.0.0.1` unless `TROUPE_BIND` says otherwise. The database
  password, access code and encryption key are generated on first start,
  never baked into an image.
- **The browser edition** has no server of its own: projects and renders
  stay in the visitor's browser, and it never asks for an API key. It sends
  nothing to Troupe; it downloads models from Hugging Face and the chat's
  WebGPU library from GitHub.

## What you are responsible for

- Serving the studio over HTTPS when it is reachable from other machines.
- Keeping `.env`, `secret.key` and database backups private.
- Setting `TOKEN` (`TROUPE_RENDERER_TOKEN`) on a renderer that other machines
  can reach: without it, anyone who reaches its port can render on it.
- The models you connect: a local endpoint runs whatever code you put behind it.
