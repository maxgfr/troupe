import { desc, eq, or } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, projectProcedure } from "~/server/api/trpc";
import type { Db } from "~/server/db/types";
import { TRPCError } from "@trpc/server";
import {
  MAX_SCRIPT_LINES,
  SUPPORTED_EMOTIONS,
  ScriptEmotionsMismatchError,
  ScriptTooManyLinesError,
  getScriptHistory,
  lockScript,
  pasteScript,
  restoreScriptVersion,
  scripts,
  setLineEmotion,
} from "~/modules/script";
import { generations } from "~/modules/generation";
import { chatMessages } from "~/modules/chat";
import { projects } from "~/modules/studio";
import { assertScriptInProject } from "./_scope";

const EMOTION = z.enum(SUPPORTED_EMOTIONS);

// Trying emotions on the newest version changes it in place, as long as no
// render was made from it and no chat message refers to it: those keep the
// version exactly as they saw it, so a retag then adds a version.
// Decided under the project's row lock (no key update), which conflicts with
// the one every new version is allocated under (insertScript): a version
// added by the chat, a restore or a paste either commits first, and this one
// is no longer the newest, or waits until the retag is done.
async function retaggableInPlace(db: Db, projectId: string, scriptId: string): Promise<boolean> {
  await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for("no key update");
  const [newest] = await db
    .select({ id: scripts.id })
    .from(scripts)
    .where(eq(scripts.projectId, projectId))
    .orderBy(desc(scripts.version))
    .limit(1);
  if (newest?.id !== scriptId) return false;
  const [rendered] = await db
    .select({ id: generations.id })
    .from(generations)
    .where(eq(generations.scriptId, scriptId))
    .limit(1);
  if (rendered) return false;
  const [discussed] = await db
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(or(eq(chatMessages.baseScriptId, scriptId), eq(chatMessages.appliedScriptId, scriptId)))
    .limit(1);
  return !discussed;
}

// Script editing + emotion tags. All keyed by `projectId` (workspace-scoped via
// projectProcedure); scriptId-bearing calls also verify the script belongs to
// that project.
export const scriptRouter = createTRPCRouter({
  // `emotions` (one per non-empty line, null to keep it) tags the lines in
  // the same version, as the CLI's script files do.
  paste: projectProcedure
    .input(
      z.object({ text: z.string().min(1), emotions: z.array(EMOTION.nullable()).max(MAX_SCRIPT_LINES).optional() }),
    )
    .mutation(({ ctx, input }) =>
      pasteScript(ctx.db, { projectId: input.projectId, text: input.text, emotions: input.emotions }).catch(
        (error: unknown) => {
          if (error instanceof ScriptEmotionsMismatchError || error instanceof ScriptTooManyLinesError)
            throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
          throw error;
        },
      ),
    ),

  history: projectProcedure.query(({ ctx, input }) => getScriptHistory(ctx.db, input.projectId)),

  restore: projectProcedure.input(z.object({ scriptId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    await assertScriptInProject(ctx.db, input.scriptId, input.projectId);
    return restoreScriptVersion(ctx.db, input.scriptId);
  }),

  setLineEmotion: projectProcedure
    .input(z.object({ scriptId: z.string().uuid(), lineIndex: z.number().int().min(0), emotion: EMOTION }))
    .mutation(async ({ ctx, input }) => {
      await assertScriptInProject(ctx.db, input.scriptId, input.projectId);
      // Decided and done under the version's update lock: a launch recording
      // this version (share lock) either finishes first, and the retag adds a
      // version, or waits until the retag is done.
      return ctx.db.transaction(async (tx) => {
        const conn = tx as unknown as Db;
        await lockScript(conn, input.scriptId, "update");
        const amend = await retaggableInPlace(conn, input.projectId, input.scriptId);
        return setLineEmotion(conn, {
          scriptId: input.scriptId,
          lineIndex: input.lineIndex,
          emotion: input.emotion,
          amend,
        });
      });
    }),
});
