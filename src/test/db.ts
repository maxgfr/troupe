import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import * as schema from "~/server/db/schema";
import { migratePglite, type Migration } from "~/server/db/pglite-migrate";

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

// Every drizzle/*.sql migration, in order.
export function readMigrations(): Migration[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(DIR, name), "utf8") }));
}

// `until` stops after the migration whose number prefix matches (e.g. "0014"),
// so a test can insert legacy rows before running the rest with migrateTestDb.
export async function createTestDb(opts: { until?: string } = {}): Promise<TestDb> {
  const pg = new PGlite();
  const applied = await migratePglite(pg, readMigrations().filter((m) => !opts.until || m.name.slice(0, 4) <= opts.until));
  return { db: drizzle(pg, { schema }), pg, applied };
}

export async function migrateTestDb(t: TestDb): Promise<void> {
  t.applied.push(...(await migratePglite(t.pg, readMigrations())));
}

// Impersonate a signed-in user: assume the authenticated role and set the JWT
// claims RLS policies read through auth.uid().
export async function setAuthUser(t: TestDb, userId: string): Promise<void> {
  await t.pg.exec(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);`);
}

export async function resetAuth(t: TestDb): Promise<void> {
  await t.pg.exec(`reset role; select set_config('request.jwt.claims', '', false);`);
}
