import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";

import { prepareDatabase } from "./prepare";

const migrationsFolder = join(process.cwd(), "drizzle");

describe("database preparation on start", () => {
  it("brings an empty Postgres to the latest schema and is a no-op the second time", async () => {
    const pg = new PGlite();
    try {
      const db = drizzle(pg);
      const run = () =>
        prepareDatabase({ exec: (sql) => pg.exec(sql), migrate: () => migrate(db, { migrationsFolder }) });
      await run();
      await run();
      const tables = (
        await pg.query<{ tablename: string }>(
          `select tablename from pg_tables where schemaname = 'public' and tablename like 'troupe_%' order by 1`,
        )
      ).rows.map((r) => r.tablename);
      expect(tables).toEqual(
        expect.arrayContaining([
          "troupe_generation",
          "troupe_model_config",
          "troupe_studio_settings",
          "troupe_project",
        ]),
      );
      const watchColumns = (
        await pg.query<{ column_name: string }>(
          `select column_name from information_schema.columns where table_name = 'troupe_generation_watch'`,
        )
      ).rows.map((r) => r.column_name);
      expect(watchColumns).toContain("deadlineAt");
      expect(watchColumns).not.toContain("provider");
    } finally {
      await pg.close();
    }
  });

  it("keeps an existing auth.uid() (Supabase) untouched", async () => {
    const pg = new PGlite();
    try {
      await pg.exec(
        `create schema auth; create function auth.uid() returns uuid language sql stable as $$ select '00000000-0000-4000-8000-000000000009'::uuid $$;`,
      );
      await prepareDatabase({ exec: (sql) => pg.exec(sql), migrate: () => migrate(drizzle(pg), { migrationsFolder }) });
      expect((await pg.query<{ uid: string }>("select auth.uid() as uid")).rows[0]!.uid).toBe(
        "00000000-0000-4000-8000-000000000009",
      );
    } finally {
      await pg.close();
    }
  });
});
