import { beforeAll, describe, expect, it } from "vitest";

import { createTestDb, setAuthUser, resetAuth, type TestDb } from "~/test/db";
import { workspaces } from "~/modules/identity/server/schema";
import { createWorkspace, listWorkspacesFor, assertMembership } from "~/modules/identity";

const UA = "11111111-1111-4111-8111-111111111111";
const UB = "22222222-2222-4222-8222-222222222222";

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
});

describe("authentication and brand workspaces", () => {
  it("a signed-in user creating a workspace becomes its owner and gets the workspace context", async () => {
    const ws = await createWorkspace(t.db, { userId: UA, name: "Brand A" });
    expect(ws.ownerId).toBe(UA);
    const mine = await listWorkspacesFor(t.db, UA);
    expect(mine.map((w) => w.id)).toContain(ws.id);
    const membership = await assertMembership(t.db, { workspaceId: ws.id, userId: UA });
    expect(membership.role).toBe("owner");
  });

  it("RLS — a member of workspace A never sees workspace B rows, even without app filters", async () => {
    const a = await createWorkspace(t.db, { userId: UA, name: "RLS A" });
    const b = await createWorkspace(t.db, { userId: UB, name: "RLS B" });

    await setAuthUser(t, UA);
    // Unfiltered SELECT as the authenticated user: RLS must do the isolation.
    const visible = await t.db.select().from(workspaces);
    await resetAuth(t);

    const ids = visible.map((w) => w.id);
    expect(ids).toContain(a.id);
    expect(ids).not.toContain(b.id);
  });

  it("a valid session without membership gets an authorization error and no data", async () => {
    const b = await createWorkspace(t.db, { userId: UB, name: "No access" });
    await expect(assertMembership(t.db, { workspaceId: b.id, userId: UA })).rejects.toThrowError(/not a member/i);
  });

  it("the RLS policies are enforced by Postgres, not by a superuser bypass", async () => {
    // Sanity: the test role really is subject to RLS (no BYPASSRLS).
    await setAuthUser(t, UA);
    const row = (await t.pg.query<{ current_user: string }>("select current_user")).rows[0]!;
    await resetAuth(t);
    expect(row.current_user).toBe("authenticated");
  });
});
