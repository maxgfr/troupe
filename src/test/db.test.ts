import { describe, expect, it } from "vitest";

import { createTestDb, migrateTestDb, readMigrations, setAuthUser } from "./db";

describe("migrateTestDb", () => {
  it("migrates as the owner while a user is impersonated, and keeps impersonating them", async () => {
    const userId = "6f1c0e8a-2b7d-4c1e-9a53-0d6e2f4b8c11";
    const t = await createTestDb({ until: "0001" });
    await setAuthUser(t, userId);
    await migrateTestDb(t);
    expect(t.applied).toEqual(readMigrations().map((m) => m.name));
    const { rows } = await t.pg.query<{ role: string; claims: string }>("select current_user as role, current_setting('request.jwt.claims', true) as claims");
    expect(rows[0]).toEqual({ role: "authenticated", claims: JSON.stringify({ sub: userId }) });
  });
});
