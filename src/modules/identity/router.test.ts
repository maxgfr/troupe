import { beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "~/test/db";
import { createWorkspace } from "~/modules/identity";
import { testCaller } from "~/test/caller";

const MEMBER = "f1111111-1111-4111-8111-111111111111";
const STRANGER = "f2222222-2222-4222-8222-222222222222";

let t: TestDb;
let ws: string;

beforeAll(async () => {
  t = await createTestDb();
  ws = (await createWorkspace(t.db, { userId: MEMBER, name: "Router" })).id;
});

// The workspace-scoped tRPC procedure itself
// fails closed — not just the helper underneath it.
describe("workspace-scoped tRPC procedures", () => {
  it("a valid session without membership gets FORBIDDEN and no data", async () => {
    const caller = testCaller({ db: t.db, userId: STRANGER });
    await expect(caller.identity.projects({ workspaceId: ws })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a member passes the same procedure", async () => {
    const caller = testCaller({ db: t.db, userId: MEMBER });
    const projects = await caller.identity.projects({ workspaceId: ws });
    expect(Array.isArray(projects)).toBe(true);
  });

  it("no session at all is UNAUTHORIZED", async () => {
    const caller = testCaller({ db: t.db, userId: null });
    await expect(caller.identity.projects({ workspaceId: ws })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
