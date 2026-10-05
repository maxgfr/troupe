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

type Tx = Pick<PGliteInterface, "exec" | "query">;

const byName = (migrations: readonly Migration[]) => [...migrations].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

async function apply(tx: Tx, migration: Migration) {
  for (const statement of migration.sql.split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (sql) await tx.exec(sql);
  }
  await tx.query("insert into troupe_static_migrations (name) values ($1)", [migration.name]);
}

// Applies the migrations not recorded yet, each in its own transaction.
// Returns the names it applied, in order.
export async function migratePglite(pg: Pg, migrations: readonly Migration[]): Promise<string[]> {
  await pg.exec(AUTH_PREAMBLE);
  const done = new Set((await pg.query<{ name: string }>("select name from troupe_static_migrations")).rows.map((r) => r.name));
  const pending = byName(migrations.filter((m) => !done.has(m.name)));
  for (const migration of pending) await pg.transaction((tx) => apply(tx, migration));
  await pg.exec(GRANTS);
  return pending.map((m) => m.name);
}

// Drops every table and applies all the migrations again, in one transaction:
// queries sent meanwhile wait, then see an empty database ("Delete all local
// data" in the browser edition).
export async function rebuildPglite(pg: Pg, migrations: readonly Migration[]): Promise<string[]> {
  const all = byName(migrations);
  await pg.transaction(async (tx) => {
    await tx.exec("drop schema public cascade; create schema public;");
    await tx.exec(AUTH_PREAMBLE);
    for (const migration of all) await apply(tx, migration);
    await tx.exec(GRANTS);
  });
  return all.map((m) => m.name);
}

// Everything a database holds, as plain JSON: the migrations it has applied
// and every table's rows, as Postgres writes them (json_agg). The browser
// edition's backups carry one.
export interface PgliteSnapshot {
  migrations: string[];
  tables: Record<string, unknown[]>;
}

// The backup comes from a build with migrations this one does not have.
export class BackupTooNewError extends Error {
  constructor(readonly unknownMigrations: string[]) {
    super("This backup was made by a newer version of Troupe. Reload the page to get the latest version, then import it again.");
    this.name = "BackupTooNewError";
  }
}

const ident = (name: string) => `"${name.replaceAll('"', '""')}"`;

async function publicTables(tx: Tx): Promise<string[]> {
  const { rows } = await tx.query<{ name: string }>(
    `select table_name as name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'troupe_static_migrations'
     order by table_name`,
  );
  return rows.map((r) => r.name);
}

// Reads the whole database in one transaction, so the tables agree.
export function snapshotPglite(pg: Pg): Promise<PgliteSnapshot> {
  return pg.transaction(async (tx) => {
    const migrations = (await tx.query<{ name: string }>("select name from troupe_static_migrations order by name")).rows.map((r) => r.name);
    const tables: Record<string, unknown[]> = {};
    for (const name of await publicTables(tx)) {
      const { rows } = await tx.query<{ rows: unknown[] }>(`select coalesce(json_agg(t), '[]'::json) as rows from ${ident(name)} t`);
      tables[name] = rows[0]?.rows ?? [];
    }
    return { migrations, tables };
  });
}

// The rows went in with foreign-key triggers off: each foreign key is added
// again, which makes Postgres check every row against it, so a damaged backup
// (a row pointing at one it does not contain) is refused, not half-restored.
async function checkForeignKeys(tx: Tx) {
  const { rows } = await tx.query<{ name: string; tbl: string; def: string }>(
    `select c.conname as name, c.conrelid::regclass::text as tbl, pg_get_constraintdef(c.oid) as def
     from pg_constraint c join pg_namespace n on n.oid = c.connamespace
     where c.contype = 'f' and n.nspname = 'public'
     order by c.conname`,
  );
  for (const fk of rows) {
    try {
      await tx.exec(`alter table ${fk.tbl} drop constraint ${ident(fk.name)}, add constraint ${ident(fk.name)} ${fk.def}`);
    } catch {
      throw new Error(`This backup is damaged: rows in ${fk.tbl.replaceAll('"', "")} point at rows it does not contain (${fk.name}). Nothing was changed.`);
    }
  }
}

// Replaces everything with a snapshot, in one transaction: the tables are
// rebuilt at the snapshot's own migrations, its rows go back in, then the
// migrations it predates run on them, exactly as an upgrade would. A snapshot
// from a newer build, or rows that do not fit, change nothing. Returns the
// migrations applied after the rows.
export async function restorePglite(pg: Pg, migrations: readonly Migration[], snapshot: PgliteSnapshot): Promise<string[]> {
  const known = new Set(migrations.map((m) => m.name));
  const unknown = snapshot.migrations.filter((name) => !known.has(name));
  if (unknown.length > 0) throw new BackupTooNewError(unknown);
  const recorded = new Set(snapshot.migrations);
  const all = byName(migrations);
  const later = all.filter((m) => !recorded.has(m.name));
  await pg.transaction(async (tx) => {
    await tx.exec("drop schema public cascade; create schema public;");
    await tx.exec(AUTH_PREAMBLE);
    for (const migration of all.filter((m) => recorded.has(m.name))) await apply(tx, migration);
    const tables = await publicTables(tx);
    const missing = Object.keys(snapshot.tables).filter((name) => !tables.includes(name));
    if (missing.length > 0) throw new Error(`This backup does not fit its own database version (unknown tables: ${missing.join(", ")}).`);
    // Rows go in whatever the order of the tables: foreign keys are checked
    // by triggers, which a restore skips (they held when the snapshot was taken).
    if (tables.length > 0) await tx.exec(`truncate ${tables.map(ident).join(", ")}`);
    await tx.exec("set local session_replication_role = replica");
    for (const [name, rows] of Object.entries(snapshot.tables)) {
      if (rows.length === 0) continue;
      await tx.query(`insert into ${ident(name)} select * from json_populate_recordset(null::${ident(name)}, $1::json)`, [JSON.stringify(rows)]);
    }
    await tx.exec("set local session_replication_role = origin");
    await checkForeignKeys(tx);
    for (const migration of later) await apply(tx, migration);
    await tx.exec(GRANTS);
  });
  return later.map((m) => m.name);
}
