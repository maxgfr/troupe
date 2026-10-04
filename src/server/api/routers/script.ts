import { z } from "zod";

import { createTRPCRouter, projectProcedure } from "~/server/api/trpc";
import { SUPPORTED_EMOTIONS, getScriptHistory, pasteScript, restoreScriptVersion, setLineEmotion } from "~/modules/script";
import { assertScriptInProject } from "./_scope";

const EMOTION = z.enum(SUPPORTED_EMOTIONS);

// Script editing + emotion tags. All keyed by `projectId` (workspace-scoped via
// projectProcedure); scriptId-bearing calls also verify the script belongs to
// that project.
export const scriptRouter = createTRPCRouter({
  paste: projectProcedure
    .input(z.object({ text: z.string().min(1) }))
    .mutation(({ ctx, input }) => pasteScript(ctx.db, { projectId: input.projectId, text: input.text })),

  history: projectProcedure.query(({ ctx, input }) => getScriptHistory(ctx.db, input.projectId)),

  restore: projectProcedure
    .input(z.object({ scriptId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertScriptInProject(ctx.db, input.scriptId, input.projectId);
      return restoreScriptVersion(ctx.db, input.scriptId);
    }),

  setLineEmotion: projectProcedure
    .input(z.object({ scriptId: z.string().uuid(), lineIndex: z.number().int().min(0), emotion: EMOTION }))
    .mutation(async ({ ctx, input }) => {
      await assertScriptInProject(ctx.db, input.scriptId, input.projectId);
      return setLineEmotion(ctx.db, { scriptId: input.scriptId, lineIndex: input.lineIndex, emotion: input.emotion });
    }),
});
