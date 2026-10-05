import { desc, eq, or } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, projectProcedure } from "~/server/api/trpc";
import type { Db } from "~/server/db/types";
import { SUPPORTED_EMOTIONS, getScriptHistory, pasteScript, restoreScriptVersion, scripts, setLineEmotion } from "~/modules/script";
import { generations } from "~/modules/generation";
import { chatMessages } from "~/modules/chat";
import { assertScriptInProject } from "./_scope";

const EMOTION = z.enum(SUPPORTED_EMOTIONS);

// Trying emotions on the newest version changes it in place, as long as no
// render was made from it and no chat message refers to it: those keep the
// version exactly as they saw it, so a retag then adds a version.
async function retaggableInPlace(db: Db, projectId: string, scriptId: string): Promise<boolean> {
  const [newest] = await db.select({ id: scripts.id }).from(scripts).where(eq(scripts.projectId, projectId)).orderBy(desc(scripts.version)).limit(1);
  if (newest?.id !== scriptId) return false;
  const [rendered] = await db.select({ id: generations.id }).from(generations).where(eq(generations.scriptId, scriptId)).limit(1);
  if (rendered) return false;
  const [discussed] = await db.select({ id: chatMessages.id }).from(chatMessages).where(or(eq(chatMessages.baseScriptId, scriptId), eq(chatMessages.appliedScriptId, scriptId))).limit(1);
  return !discussed;
}

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
      const amend = await retaggableInPlace(ctx.db, input.projectId, input.scriptId);
      return setLineEmotion(ctx.db, { scriptId: input.scriptId, lineIndex: input.lineIndex, emotion: input.emotion, amend });
    }),
});
