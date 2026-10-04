// Run after migrations: node --env-file=.env.local scripts/configure-cloud.mjs https://your-studio.vercel.app
import postgres from "postgres";
import { databaseTls } from "./database-tls.mjs";
import { createClient } from "@supabase/supabase-js";
const origin = new URL(process.argv[2] ?? "");
if (origin.protocol !== "https:") throw new Error("An HTTPS studio URL is required.");
for (const key of ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RECONCILE_SECRET"]) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
}
const db = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, ssl: databaseTls(process.env.DATABASE_URL), onnotice: () => {} });
try {
  const storage = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY).storage;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "troupe-media";
  if ((await storage.getBucket(bucket)).error) {
    const result = await storage.createBucket(bucket, { public: false, allowedMimeTypes: ["video/mp4"], fileSizeLimit: 50 * 1024 * 1024 });
    if (result.error) throw new Error("Could not create the private media bucket.");
  }
  const verified = await storage.getBucket(bucket);
  if (verified.error || verified.data.public) throw new Error("Media bucket must be private.");
  await db`create extension if not exists pg_cron`;
  await db`create extension if not exists pg_net with schema extensions`;
  // Postgres quotes both arguments; credentials never appear in source or logs.
  const [{ command }] = await db`select format('select net.http_post(url := %L, headers := %L::jsonb, body := ''{}''::jsonb, timeout_milliseconds := 55000);', ${new URL("/api/jobs/reconcile", origin).href}::text, ${JSON.stringify({ "content-type": "application/json", "x-reconcile-secret": process.env.RECONCILE_SECRET })}::text) as command`;
  await db`select cron.schedule('troupe-reconcile', '* * * * *', ${command})`;
  console.log("Private media bucket and minute-by-minute reconciliation configured.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Cloud setup failed."); process.exitCode = 1;
} finally { await db.end(); }
