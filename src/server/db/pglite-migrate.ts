import type { PGliteInterface } from "@electric-sql/pglite";

// Brings a PGlite database up to date with the Drizzle migrations in drizzle/.
// It takes their text rather than reading files, so the same code serves the
// tests (read from disk) and a database kept in the browser (bundled), where a
// database outlives each deploy: the ones already applied are recorded in
// troupe_static_migrations and skipped.

export interface Migration {
  // File name, e.g. "0003_actors.sql"; migrations apply in name order.
  name: string;
  sql: string;
}

type Pg = Pick<PGliteInterface, "exec" | "query" | "transaction">;

// Supabase provides the `authenticated` role and `auth.uid()`; the RLS policies
// in the migrations need both, so they apply exactly as in production.
const AUTH_PREAMBLE = `
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin;
    end if;
  end $$;
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $$;
  create table if not exists troupe_static_migrations (
    name text primary key,
    "appliedAt" timestamptz not null default now()
  );
`;

// Run after every migration batch: new tables need the grant too.
const GRANTS = `
  grant usage on schema public to authenticated;
  grant select on all tables in schema public to authenticated;
`;

// Applies the migrations not recorded yet, each in its own transaction.
// Returns the names it applied, in order.
export async function migratePglite(pg: Pg, migrations: readonly Migration[]): Promise<string[]> {
  await pg.exec(AUTH_PREAMBLE);
  const done = new Set((await pg.query<{ name: string }>("select name from troupe_static_migrations")).rows.map((r) => r.name));
  const pending = migrations.filter((m) => !done.has(m.name)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const migration of pending) {
    await pg.transaction(async (tx) => {
      for (const statement of migration.sql.split("--> statement-breakpoint")) {
        const sql = statement.trim();
        if (sql) await tx.exec(sql);
      }
      await tx.query("insert into troupe_static_migrations (name) values ($1)", [migration.name]);
    });
  }
  await pg.exec(GRANTS);
  return pending.map((m) => m.name);
}
