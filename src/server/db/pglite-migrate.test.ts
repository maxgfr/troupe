import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import { getProject } from "~/modules/studio/server/service";
import { readMigrations } from "~/test/db";
import { seedFixture } from "~/test/fixture";
import * as schema from "./schema";
import type { Db } from "./types";
import {
  BackupTooNewError,
  migratePglite,
  rebuildPglite,
  restorePglite,
  snapshotPglite,
  type PgliteSnapshot,
} from "./pglite-migrate";

let pg: PGlite | undefined;
afterEach(async () => {
  await pg?.close();
  pg = undefined;
});

const USER = "11111111-1111-4111-8111-111111111111";

// A studio with one project and its script, at the given migrations.
async function studioWithProject(migrations = readMigrations()) {
  pg = new PGlite();
  await migratePglite(pg, migrations);
  const db = drizzle(pg, { schema }) as unknown as Db;
  await pg.exec(`insert into troupe_user (id, email) values ('${USER}', 'a@example.com')`);
  const fixture = await seedFixture(db, { userId: USER, name: "Kept" });
  return { pg, db, fixture };
}

const count = async (db: PGlite, table: string) =>
  (await db.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]!.n;

// What an archive carries: the snapshot as JSON text, read back.
const throughJson = (snapshot: PgliteSnapshot): PgliteSnapshot =>
  JSON.parse(JSON.stringify(snapshot)) as PgliteSnapshot;

async function recorded(db: PGlite) {
  return (await db.query<{ name: string }>("select name from troupe_static_migrations order by name")).rows.map(
    (r) => r.name,
  );
}

describe("PGlite migrations", () => {
  it("applies only the migrations it has not recorded yet, and can run again on the same database", async () => {
    pg = new PGlite();
    const all = readMigrations();
    expect(await migratePglite(pg, all.slice(0, 2))).toEqual([all[0]!.name, all[1]!.name]);
    expect(await recorded(pg)).toEqual([all[0]!.name, all[1]!.name]);

    expect(await migratePglite(pg, all)).toEqual(all.slice(2).map((m) => m.name));
    expect(await migratePglite(pg, all)).toEqual([]);
    expect(await recorded(pg)).toEqual(all.map((m) => m.name));
  });

  it("applies migrations in name order whatever order they are given in", async () => {
    pg = new PGlite();
    const all = readMigrations();
    expect(await migratePglite(pg, [...all].reverse())).toEqual(all.map((m) => m.name));
  });

  it("creates the auth preamble the RLS policies need, and the read grants", async () => {
    pg = new PGlite();
    await migratePglite(pg, readMigrations());
    const role = await pg.query<{ n: number }>(
      "select count(*)::int as n from pg_roles where rolname = 'authenticated'",
    );
    expect(role.rows[0]!.n).toBe(1);
    await pg.exec(`select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', false);`);
    const uid = await pg.query<{ uid: string }>("select auth.uid() as uid");
    expect(uid.rows[0]!.uid).toBe("11111111-1111-4111-8111-111111111111");
    await pg.exec("set role authenticated");
    await expect(pg.query("select count(*) from troupe_project")).resolves.toBeTruthy();
  });

  // On Supabase every public table is reachable through the Data API with the
  // anon key unless row level security is on (no policy then means no access).
  // troupe_static_migrations is this PGlite runner's own ledger.
  it("turns row level security on for every table, so Supabase's Data API cannot reach them", async () => {
    pg = new PGlite();
    await migratePglite(pg, readMigrations());
    const open = await pg.query<{ relname: string }>(
      "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'troupe\\_%' and c.relname <> 'troupe_static_migrations' and not c.relrowsecurity order by 1",
    );
    expect(open.rows.map((r) => r.relname)).toEqual([]);
  });

  it("rolls back a failing migration entirely and does not record it", async () => {
    pg = new PGlite();
    const broken = {
      name: "9999_broken.sql",
      sql: "create table half_done (id int);\n--> statement-breakpoint\nselect * from no_such_table;",
    };
    await expect(migratePglite(pg, [broken])).rejects.toThrow();
    const left = await pg.query<{ n: number }>(
      "select count(*)::int as n from information_schema.tables where table_name = 'half_done'",
    );
    expect(left.rows[0]!.n).toBe(0);
    expect(await recorded(pg)).toEqual([]);
  });

  it("rebuilds an empty database at the latest migration, as one transaction", async () => {
    pg = new PGlite();
    const all = readMigrations();
    await migratePglite(pg, all);
    await pg.exec(
      "insert into troupe_user (id, email) values ('11111111-1111-4111-8111-111111111111', 'a@example.com')",
    );
    // A query sent while the rebuild runs waits for it, then finds the tables empty.
    const [rebuilt, during] = await Promise.all([
      rebuildPglite(pg, all),
      pg.query<{ n: number }>("select count(*)::int as n from troupe_user"),
    ]);
    expect(rebuilt).toEqual(all.map((m) => m.name));
    expect(during.rows[0]!.n).toBe(0);
    expect(await recorded(pg)).toEqual(all.map((m) => m.name));
  });

  // A browser keeps its database from one deploy to the next: a build that
  // adds a migration applies only that one, on top of the projects.
  it("keeps a studio's projects when a later build adds a migration", async () => {
    const { pg, db, fixture } = await studioWithProject();
    const added = {
      name: "9999_upgrade-test.sql",
      sql: `alter table troupe_project add column "upgradeNote" text not null default 'kept';`,
    };
    expect(await migratePglite(pg, [...readMigrations(), added])).toEqual([added.name]);
    expect((await getProject(db, fixture.projectId))?.title).toBe("Kept project");
    const note = await pg.query<{ upgradeNote: string }>(`select "upgradeNote" from troupe_project where id = $1`, [
      fixture.projectId,
    ]);
    expect(note.rows).toEqual([{ upgradeNote: "kept" }]);
    expect(await count(pg, "troupe_script_line")).toBeGreaterThan(0);
  });
});

describe("PGlite snapshots (backups of the browser edition)", () => {
  it("restores every table after the studio was emptied", async () => {
    const { pg, db, fixture } = await studioWithProject();
    const before = throughJson(await snapshotPglite(pg));
    expect(before.migrations).toEqual(readMigrations().map((m) => m.name));
    expect(before.tables.troupe_project).toHaveLength(1);
    expect(before.tables).not.toHaveProperty("troupe_static_migrations");

    await rebuildPglite(pg, readMigrations());
    expect(await count(pg, "troupe_project")).toBe(0);

    expect(await restorePglite(pg, readMigrations(), before)).toEqual([]);
    expect(throughJson(await snapshotPglite(pg))).toEqual(before);
    expect((await getProject(db, fixture.projectId))?.title).toBe("Kept project");
    expect(await recorded(pg)).toEqual(readMigrations().map((m) => m.name));
  });

  it("brings a snapshot from an earlier build up to date with the migrations it predates", async () => {
    const all = readMigrations();
    const { pg: old } = await studioWithProject(all.slice(0, -1));
    const snapshot = throughJson(await snapshotPglite(old));
    await old.close();

    pg = new PGlite();
    await migratePglite(pg, all);
    expect(await restorePglite(pg, all, snapshot)).toEqual([all.at(-1)!.name]);
    expect(await count(pg, "troupe_project")).toBe(1);
    expect(await recorded(pg)).toEqual(all.map((m) => m.name));
  });

  it("refuses a snapshot from a newer build and changes nothing", async () => {
    const { pg } = await studioWithProject();
    const snapshot = throughJson(await snapshotPglite(pg));
    const newer = { ...snapshot, migrations: [...snapshot.migrations, "9999_from-the-future.sql"] };
    await expect(restorePglite(pg, readMigrations(), newer)).rejects.toBeInstanceOf(BackupTooNewError);
    expect(await count(pg, "troupe_project")).toBe(1);
  });

  it("refuses a hand-damaged backup whose rows point at rows it does not contain", async () => {
    const { pg } = await studioWithProject();
    const snapshot = throughJson(await snapshotPglite(pg));
    const project = snapshot.tables.troupe_project![0] as Record<string, unknown>;
    const orphan = {
      ...snapshot,
      tables: {
        ...snapshot.tables,
        troupe_project: [{ ...project, workspaceId: "99999999-9999-4999-8999-999999999999" }],
      },
    };
    await expect(restorePglite(pg, readMigrations(), orphan)).rejects.toThrow(
      /This backup is damaged: rows in troupe_project point at rows it does not contain/,
    );
    // Children left without their parent are refused too.
    const headless = { ...snapshot, tables: { ...snapshot.tables, troupe_project: [] } };
    await expect(restorePglite(pg, readMigrations(), headless)).rejects.toThrow(/This backup is damaged/);
    expect(throughJson(await snapshotPglite(pg))).toEqual(snapshot);
  });

  it("reports a failure re-checking the foreign keys as it is, not as a damaged backup", async () => {
    const { pg } = await studioWithProject();
    const snapshot = throughJson(await snapshotPglite(pg));
    // The database fails while re-adding a foreign key, for its own reasons.
    const failing: Parameters<typeof restorePglite>[0] = {
      exec: (sql) => pg.exec(sql),
      query: (sql, params) => pg.query(sql, params),
      transaction: (run) =>
        pg.transaction((tx) =>
          run(
            Object.assign(Object.create(tx) as typeof tx, {
              exec: (sql: string) =>
                /^alter table .* add constraint/s.test(sql)
                  ? Promise.reject(
                      Object.assign(new Error("could not extend file: No space left on device"), { code: "53100" }),
                    )
                  : tx.exec(sql),
            }),
          ),
        ),
    };
    await expect(restorePglite(failing, readMigrations(), snapshot)).rejects.toThrow(
      "could not extend file: No space left on device",
    );
    expect(throughJson(await snapshotPglite(pg))).toEqual(snapshot);
  });

  it("rolls back entirely when the rows do not fit", async () => {
    const { pg } = await studioWithProject();
    const snapshot = throughJson(await snapshotPglite(pg));
    const broken = { ...snapshot, tables: { ...snapshot.tables, troupe_project: [{ id: "not-a-uuid" }] } };
    await expect(restorePglite(pg, readMigrations(), broken)).rejects.toThrow();
    const unknown = { ...snapshot, tables: { ...snapshot.tables, troupe_nothing: [] } };
    await expect(restorePglite(pg, readMigrations(), unknown)).rejects.toThrow(/troupe_nothing/);
    expect(throughJson(await snapshotPglite(pg))).toEqual(snapshot);
  });
});
