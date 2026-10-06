import { createTRPCRouter, protectedProcedure, workspaceProcedure } from "~/server/api/trpc";
import { listWorkspacesFor } from "~/modules/identity";
import { listProjects } from "~/server/projects";

export const identityRouter = createTRPCRouter({
  myWorkspaces: protectedProcedure.query(({ ctx }) => listWorkspacesFor(ctx.db, ctx.userId)),
  // Workspace-scoped — a non-member gets FORBIDDEN, never data.
  // Each with the stage it is at (draft, scripting, generating, review, done)
  // and the address of its newest saved video, the poster the dashboard plays.
  projects: workspaceProcedure.query(async ({ ctx, input }) =>
    (await listProjects(ctx.db, input.workspaceId)).map(({ latestVideoAssetId, ...project }) => ({
      ...project,
      latestVideoUrl: latestVideoAssetId ? ctx.media.urlFor(latestVideoAssetId) : null,
    })),
  ),
});
