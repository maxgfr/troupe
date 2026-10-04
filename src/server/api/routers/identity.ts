import { desc, eq } from "drizzle-orm";

import { createTRPCRouter, protectedProcedure, workspaceProcedure } from "~/server/api/trpc";
import { listWorkspacesFor } from "~/modules/identity";
import { projects } from "~/modules/studio";

export const identityRouter = createTRPCRouter({
  myWorkspaces: protectedProcedure.query(({ ctx }) => listWorkspacesFor(ctx.db, ctx.userId)),
  // Workspace-scoped — a non-member gets FORBIDDEN, never data.
  projects: workspaceProcedure.query(({ ctx, input }) =>
    ctx.db.select().from(projects).where(eq(projects.workspaceId, input.workspaceId)).orderBy(desc(projects.createdAt)),
  ),
});
