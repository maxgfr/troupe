import { and, asc, eq } from "drizzle-orm";

import type { Db } from "~/server/db/types";
import { workspaceMembers, workspaces } from "./schema";

// Creating a workspace makes the creator its owner, atomically.
export async function createWorkspace(db: Db, input: { userId: string; name: string }) {
  return db.transaction(async (tx) => {
    const [ws] = await tx.insert(workspaces).values({ name: input.name, ownerId: input.userId }).returning();
    if (!ws) throw new Error("workspace insert returned no row");
    await tx.insert(workspaceMembers).values({ workspaceId: ws.id, userId: input.userId, role: "owner" });
    return ws;
  });
}

export async function listWorkspacesFor(db: Db, userId: string) {
  const rows = await db
    .select({ id: workspaces.id, name: workspaces.name, ownerId: workspaces.ownerId })
    .from(workspaces)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaces.createdAt), asc(workspaces.id));
  return rows;
}

// Workspace-scoped calls resolve membership or fail closed.
export async function assertMembership(db: Db, input: { workspaceId: string; userId: string }) {
  const [m] = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, input.userId)))
    .limit(1);
  if (!m) throw new Error(`user ${input.userId} is not a member of workspace ${input.workspaceId}`);
  return m;
}
