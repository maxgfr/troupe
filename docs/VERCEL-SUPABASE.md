# Vercel + Supabase

An alternative to [Docker](SELF-HOSTING.md): Vercel serves the app, Supabase
holds the database and the videos and calls the job check every minute.

What does not come along: the Docker stack's local renderer and Ollama are not
part of a Vercel deployment. Video models are then the cloud ones (Google,
fal.ai) or local models reachable from Vercel over HTTPS (a ComfyUI or HTTP
server behind a tunnel or a reverse proxy, with a token). The script chat
needs an Anthropic key (set `TROUPE_CHAT_PROVIDER=anthropic`, or just add the
key: the chat then prefers Claude), or an Ollama server reachable over HTTPS
(`OLLAMA_URL`).

## Supabase

1. Create a project. Use its **session pooler** connection string (Connect →
   Session pooler: `aws-0-<region>.pooler.supabase.com`, port 5432, user
   `postgres.<project-ref>`, password URL-encoded) as `DATABASE_URL`. Not the
   transaction pooler (port 6543): the studio sends several queries at once on
   a connection, and the transaction pooler stalled on that in testing (see
   [What was tested](#what-was-tested)); the studio warns in its logs when
   `DATABASE_URL` points at it. Each Vercel instance keeps at most three
   connections and closes idle ones after 20 s.
2. Note `SUPABASE_URL` and the server-only `SUPABASE_SERVICE_ROLE_KEY`.
3. Generate three different secrets:

   ```bash
   openssl rand -hex 24   # TROUPE_ACCESS_CODE: opens the studio
   openssl rand -hex 32   # TROUPE_SECRET: encrypts saved API keys
   openssl rand -hex 24   # RECONCILE_SECRET: authenticates the job check
   ```

   On Vercel the file system is temporary, so Troupe cannot generate and keep
   these itself: all three are required.
4. Apply the migrations from your machine, with the **session** pooler or
   direct connection string (port 5432), not the transaction pooler:

   ```bash
   DATABASE_URL='postgresql://…:5432/postgres' pnpm db:migrate
   ```

   Run it again after each upgrade. Vercel deployments never migrate on start.
   The migrations turn row level security on for every table without adding
   a policy for Supabase's `anon` or `authenticated` keys: the Data API cannot
   read or write Troupe's tables, while the studio's own connection, which
   owns them, is unaffected.

Connections use TLS, verified against the bundled Supabase root certificate.
You can then enable SSL enforcement in the database settings.

## Vercel

Import the repository (or `vercel link`) and set these **production**
variables: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_STORAGE_BUCKET=troupe-media`, `TROUPE_ACCESS_CODE`, `TROUPE_SECRET`,
`RECONCILE_SECRET`. Provider keys are optional; you can save them in Settings
(Settings → Provider accounts → Test checks each one for free).
Never prefix any of them with `NEXT_PUBLIC_`.

```bash
vercel deploy --prod
node --env-file=.env.local scripts/configure-cloud.mjs https://your-studio.vercel.app
```

`configure-cloud.mjs` creates a **private** MP4 bucket (50 MB per file) for the
rendered videos and
schedules a `troupe-reconcile` job with Supabase
[`pg_cron`](https://supabase.com/docs/guides/cron/quickstart) and `pg_net`: every
minute it calls `POST /api/jobs/reconcile` with the `x-reconcile-secret`
header. Run it again after changing the domain or `RECONCILE_SECRET`. The
secret is stored in the cron command; do not expose the `cron` schema through
the Data API.

To trigger a check by hand:

```bash
curl -X POST -H "x-reconcile-secret: $RECONCILE_SECRET" https://your-studio.vercel.app/api/jobs/reconcile
```

The actors' pictures are not in the bucket: Vercel serves the ones checked in
under `public/actors` at `/actors`, and `TROUPE_ACTOR_PORTRAITS_URL` points the
studio at another copy (a CDN, a public bucket) laid out the same way.

Each call handles one job and stays within Vercel's
[function duration](https://vercel.com/docs/functions/configuring-functions/duration);
row locks keep concurrent calls from polling the same job. An open project page
also checks its jobs. Videos are served through short-lived signed URLs.

The Vercel build bundles a static `ffprobe` (see
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)); `FFPROBE_PATH` overrides
it.

## Checking a deployment

```bash
TROUPE_LIVE_STUDIO_URL=https://your-studio.vercel.app RECONCILE_SECRET=... \
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DATABASE_URL='postgresql://…:5432/postgres' \
pnpm verify:live --only supabase,studio
```

It calls `/api/health` and the job check, puts a small MP4 in the bucket and
reads it back through a signed URL, and checks that every migration is applied
with row level security on every table. All of it is free; see
[LIVE-CHECKS.md](LIVE-CHECKS.md).

## What was tested

On 2026-10-05, against a local Supabase (Supabase CLI 2.119.0, `supabase
start`: Postgres, Storage, Supavisor 2.9.13, `pg_cron`, `pg_net`) and the
studio built with `pnpm build` and run with `next start` and `VERCEL=1`:
the migrations (0000–0021) applied with `pnpm db:migrate`; `configure-cloud.mjs`
created the private bucket and the cron job (run from a copy that accepts
plain http, the only way to reach a local studio); `pg_cron` then called the
job check every minute and a ComfyUI render launched from the CLI completed,
was stored in the bucket, played on the project page and downloaded through a
signed URL; `troupe doctor --live --yes` did the same and asked the chat
(Ollama) once. Through the **transaction** pooler the studio hung within a
minute of opening Settings (Postgres backends waiting mid-protocol, the client
seeing `invalid frontend message type`); through the **session** pooler the
same pages and a stress of pipelined queries ran without a stall. Not tested:
a real Vercel deployment, Supabase's hosted pooler and TLS, and the static
`ffprobe` on Vercel's Linux.

## Operations

- Settings → Background checks shows when the last check ran. If it is stale,
  look at the Supabase cron history and the Vercel function logs.
- `DOWNLOAD_RETRY` retries saving the video, never the paid generation.
  Submissions the provider never confirmed end as `SUBMISSION_UNKNOWN`: check
  the provider dashboard before launching again.
- Changing `TROUPE_ACCESS_CODE` and redeploying signs every browser out.
  Changing `TROUPE_SECRET` makes saved keys unreadable: enter them again.
- Back up the database (and the bucket if you need old videos).
