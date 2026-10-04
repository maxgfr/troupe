# Security

Please report vulnerabilities privately through
[GitHub security advisories](https://github.com/maxgfr/troupe/security/advisories/new),
not in public issues. You should get an answer within a week.

## What Troupe protects

- **Access.** In production every page and every data or media request
  requires the access code's cookie, whatever the request's `Host` header
  says. Without `TROUPE_ACCESS_CODE` a code is generated on first start. After
  five wrong codes an address waits 15 minutes. Requests from other origins
  are refused. Two routes are deliberately outside the code: `/api/health`
  (answers only `{ ok }`) and `/api/jobs/reconcile` (requires its own
  `RECONCILE_SECRET`, and refuses every call when that is unset).
- **Credentials.** Provider keys and local model tokens are encrypted with
  AES-256-GCM, bound to their database row, under `TROUPE_SECRET` or a key file
  in the data volume. They are never sent to the browser.
- **Outbound requests.** Cloud keys only go to their provider's API hosts.
  Local model URLs may target your network but not link-local or cloud metadata
  addresses; their tokens and downloads stay on the model's own origin, without
  following redirects.
- **Downloads.** Videos are size-capped and checked with ffprobe before they are
  stored.

## What you are responsible for

- Serving the studio over HTTPS when it is reachable from other machines.
- Keeping `.env`, `secret.key` and database backups private.
- The models you connect: a local endpoint runs whatever code you put behind it.
