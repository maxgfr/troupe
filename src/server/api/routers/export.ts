import { z } from "zod";

import { createTRPCRouter, projectProcedure } from "~/server/api/trpc";
import { checkExportSpecs, createExport } from "~/modules/export";
import { assertGenerationInProject } from "./_scope";

const PLATFORM = z.enum(["instagram", "youtube", "tiktok", "linkedin"]);

// Platform export presets. All keyed by projectId (workspace-scoped);
// generation references are verified in-project.
export const exportRouter = createTRPCRouter({
  checkSpecs: projectProcedure
    .input(z.object({ generationId: z.string().uuid(), platform: PLATFORM }))
    .query(async ({ ctx, input }) => {
      await assertGenerationInProject(ctx.db, input.generationId, input.projectId);
      return checkExportSpecs(ctx.db, { generationId: input.generationId, platform: input.platform });
    }),

  create: projectProcedure
    .input(
      z.object({
        generationId: z.string().uuid(),
        platform: PLATFORM,
        caption: z.string(),
        hashtags: z.array(z.string()),
        qualityConfirmed: z.boolean().optional(),
        acknowledgeSpecMismatch: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertGenerationInProject(ctx.db, input.generationId, input.projectId);
      return createExport(ctx.db, {
        generationId: input.generationId,
        platform: input.platform,
        caption: input.caption,
        hashtags: input.hashtags,
        qualityConfirmedBy: input.qualityConfirmed ? ctx.userId : undefined,
        acknowledgeSpecMismatch: input.acknowledgeSpecMismatch,
      }, ctx.media);
    }),
});
