import { createTRPCRouter, protectedProcedure, workspaceProcedure } from "~/server/api/trpc";
import { listWorkspacesFor } from "~/modules/identity";
import { listProjects } from "~/server/projects";

export const identityRouter = createTRPCRouter({
  myWorkspaces: protectedProcedure.query(({ ctx }) => listWorkspacesFor(ctx.db, ctx.userId)),
  // Workspace-scoped — a non-member gets FORBIDDEN, never data.
  // Each with the stage it is at (draft, scripting, generating, review, done).
  projects: workspaceProcedure.query(({ ctx, input }) => listProjects(ctx.db, input.workspaceId)),
});
