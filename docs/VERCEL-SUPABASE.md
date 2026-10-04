# Vercel + Supabase

An alternative to [Docker](SELF-HOSTING.md): Vercel serves the app, Supabase
holds the database and the videos and calls the job check every minute.
Local models must then be reachable from Vercel over HTTPS.

## Supabase

1. Create a project. Use its **transaction pooler** connection string (port
   6543, password URL-encoded) as `DATABASE_URL`.
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

Connections use TLS, verified against the bundled Supabase root certificate.
You can then enable SSL enforcement in the database settings.

## Vercel

Import the repository (or `vercel link`) and set these **production**
variables: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_STORAGE_BUCKET=troupe-media`, `TROUPE_ACCESS_CODE`, `TROUPE_SECRET`,
`RECONCILE_SECRET`. Provider keys are optional; you can save them in Settings.
Never prefix any of them with `NEXT_PUBLIC_`.

```bash
vercel deploy --prod
node --env-file=.env.local scripts/configure-cloud.mjs https://your-studio.vercel.app
```

`configure-cloud.mjs` creates a **private** MP4 bucket (50 MB per file) and
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

Each call handles one job and stays within Vercel's
[function duration](https://vercel.com/docs/functions/configuring-functions/duration);
row locks keep concurrent calls from polling the same job. An open project page
also checks its jobs. Videos are served through short-lived signed URLs.

The Vercel build bundles a static `ffprobe` (see
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)).

## Operations

- Settings → Background checks shows when the last check ran. If it is stale,
  look at the Supabase cron history and the Vercel function logs.
- `DOWNLOAD_RETRY` retries saving the video, never the paid generation.
  Submissions the provider never confirmed end as `SUBMISSION_UNKNOWN`: check
  the provider dashboard before launching again.
- Changing `TROUPE_ACCESS_CODE` and redeploying signs every browser out.
  Changing `TROUPE_SECRET` makes saved keys unreadable: enter them again.
- Back up the database (and the bucket if you need old videos).
