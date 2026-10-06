import { sql } from "drizzle-orm";

import type { Db } from "~/server/db/types";
import { seedActorLibrary } from "~/modules/actors";
import { users, workspaceMembers, workspaces } from "./schema";

export const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000001";
export const LOCAL_WORKSPACE_ID = "00000000-0000-4000-8000-000000000002";

// A single personal workspace, initialized without signup. The database lock
// serializes first requests across processes so the actor seed cannot race.
export async function ensureLocalStudio(db: Db) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(846726)`);
    await tx
      .insert(users)
      .values({ id: LOCAL_USER_ID, email: "local@localhost", displayName: "You" })
      .onConflictDoNothing();
    await tx
      .insert(workspaces)
      .values({ id: LOCAL_WORKSPACE_ID, name: "My studio", ownerId: LOCAL_USER_ID })
      .onConflictDoNothing();
    await tx
      .insert(workspaceMembers)
      .values({ workspaceId: LOCAL_WORKSPACE_ID, userId: LOCAL_USER_ID, role: "owner" })
      .onConflictDoNothing();
    await seedActorLibrary(tx as unknown as Db);
  });
  return { userId: LOCAL_USER_ID, workspaceId: LOCAL_WORKSPACE_ID };
}
