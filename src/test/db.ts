import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import * as schema from "~/server/db/schema";

// In-memory REAL Postgres (pglite): the `authenticated` role and `auth.uid()`
// exist before the generated migrations run, so the RLS policies apply exactly
// as in production.
export interface TestDb {
  db: ReturnType<typeof drizzle<typeof schema>>;
  pg: PGlite;
  // Migration files applied so far, in order.
  applied: string[];
}

const DIR = join(process.cwd(), "drizzle");

function migrationFiles() {
  return readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
}

async function apply(pg: PGlite, files: string[]) {
  for (const f of files) {
    const raw = readFileSync(join(DIR, f), "utf8");
    for (const stmt of raw.split("--> statement-breakpoint")) {
      const s = stmt.trim();
      if (s) await pg.exec(s);
    }
  }
}

// `until` stops after the migration whose number prefix matches (e.g. "0014"),
// so a test can insert legacy rows before running the rest with migrateTestDb.
export async function createTestDb(opts: { until?: string } = {}): Promise<TestDb> {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated nologin;
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $$;
  `);
  const files = migrationFiles().filter((f) => !opts.until || f.slice(0, 4) <= opts.until);
  await apply(pg, files);
  await grant(pg);
  return { db: drizzle(pg, { schema }), pg, applied: files };
}

export async function migrateTestDb(t: TestDb): Promise<void> {
  const rest = migrationFiles().filter((f) => !t.applied.includes(f));
  await apply(t.pg, rest);
  await grant(t.pg);
  t.applied.push(...rest);
}

async function grant(pg: PGlite) {
  await pg.exec(`
    grant usage on schema public to authenticated;
    grant select on all tables in schema public to authenticated;
  `);
}

// Impersonate a signed-in user: assume the authenticated role and set the JWT
// claims RLS policies read through auth.uid().
export async function setAuthUser(t: TestDb, userId: string): Promise<void> {
  await t.pg.exec(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);`);
}

export async function resetAuth(t: TestDb): Promise<void> {
  await t.pg.exec(`reset role; select set_config('request.jwt.claims', '', false);`);
}
