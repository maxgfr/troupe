import { afterAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "~/test/db";
import { ensureLocalStudio, LOCAL_USER_ID, LOCAL_WORKSPACE_ID, listWorkspacesFor } from "~/modules/identity";
import { listActors } from "~/modules/actors";

let t: TestDb;
afterAll(async () => {
  await t?.pg.close();
});

describe("personal studio bootstrap", () => {
  it("creates one usable workspace and actor catalog without a signup, and survives a restart", async () => {
    t = await createTestDb();
    await ensureLocalStudio(t.db);
    const actors = await listActors(t.db, {});
    await ensureLocalStudio(t.db);
    expect(await listWorkspacesFor(t.db, LOCAL_USER_ID)).toEqual([
      { id: LOCAL_WORKSPACE_ID, name: "My studio", ownerId: LOCAL_USER_ID },
    ]);
    expect(actors).toHaveLength(30);
    expect((await listActors(t.db, {})).map((a) => a.id)).toEqual(actors.map((a) => a.id));
  });
});
