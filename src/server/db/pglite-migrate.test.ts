import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

import { readMigrations } from "~/test/db";
import { migratePglite } from "./pglite-migrate";

let pg: PGlite | undefined;
afterEach(async () => { await pg?.close(); pg = undefined; });

async function recorded(db: PGlite) {
  return (await db.query<{ name: string }>("select name from troupe_static_migrations order by name")).rows.map((r) => r.name);
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
    const role = await pg.query<{ n: number }>("select count(*)::int as n from pg_roles where rolname = 'authenticated'");
    expect(role.rows[0]!.n).toBe(1);
    await pg.exec(`select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', false);`);
    const uid = await pg.query<{ uid: string }>("select auth.uid() as uid");
    expect(uid.rows[0]!.uid).toBe("11111111-1111-4111-8111-111111111111");
    await pg.exec("set role authenticated");
    await expect(pg.query("select count(*) from troupe_project")).resolves.toBeTruthy();
  });

  it("rolls back a failing migration entirely and does not record it", async () => {
    pg = new PGlite();
    const broken = { name: "9999_broken.sql", sql: "create table half_done (id int);\n--> statement-breakpoint\nselect * from no_such_table;" };
    await expect(migratePglite(pg, [broken])).rejects.toThrow();
    const left = await pg.query<{ n: number }>("select count(*)::int as n from information_schema.tables where table_name = 'half_done'");
    expect(left.rows[0]!.n).toBe(0);
    expect(await recorded(pg)).toEqual([]);
  });
});
