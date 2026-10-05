import { z } from "zod";

import { createTRPCRouter, projectProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { generations, launchGeneration, listGenerationsForProject, reconcileDueJobs } from "~/modules/generation";
import { estimateCostUsd } from "~/modules/models";
import { pickLaunchAdapter } from "./_adapters";
import { assertGenerationInProject, assertScriptInProject } from "./_scope";
import { launchText } from "./_launch";

export const MODEL_KEY = z.string().min(1).max(80);

const ALREADY_RELAUNCHED = "This render was already relaunched. Follow the newer render in the timeline.";

// A unique violation (SQLSTATE 23505) on the named index, from Postgres or
// PGlite, possibly wrapped by Drizzle.
function violates(error: unknown, index: string): boolean {
  for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    const { code, constraint, constraint_name, message } = e as { code?: unknown; constraint?: unknown; constraint_name?: unknown; message?: unknown };
    if (code === "23505" && [constraint, constraint_name, message].some((v) => typeof v === "string" && v.includes(index))) return true;
  }
  return false;
}

export const generationRouter = createTRPCRouter({
  // The project's launch timeline, newest first.
  forProject: projectProcedure.query(async ({ ctx, input }) => {
    // Polling while the monitor is open also makes pnpm dev self-contained.
    // The background worker continues the same queue after the browser closes.
    if (ctx.ingest) await reconcileDueJobs(ctx.db, { adapters: ctx.catalog.adapters, ingest: ctx.ingest, limit: 1 });
    const rows = await listGenerationsForProject(ctx.db, input.projectId);
    const labels = new Map(ctx.catalog.models.map((m) => [m.key, m.label]));
    const relaunched = new Set(rows.map((row) => row.parentGenerationId).filter(Boolean));
    return rows.map((row) => ({
      ...row,
      modelLabel: labels.get(row.modelKey) ?? row.modelId,
      relaunched: relaunched.has(row.id),
      outputAssetUrl: row.outputAssetId ? ctx.media.urlFor(row.outputAssetId) : null,
    }));
  }),

  // Try a failed render again with exactly the same script, model and settings.
  relaunch: projectProcedure
    .input(z.object({ generationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertGenerationInProject(ctx.db, input.generationId, input.projectId);
      const [failed] = await ctx.db.select().from(generations).where(eq(generations.id, input.generationId)).limit(1);
      if (failed?.status !== "failed") throw new TRPCError({ code: "BAD_REQUEST", message: "Only a failed render can be relaunched." });
      if (!failed.scriptId) throw new TRPCError({ code: "BAD_REQUEST", message: "This render has no script to relaunch from." });
      // One relaunch per failure: a second one would render (and bill) it
      // twice. When the relaunch fails too, that newer render is the one to retry.
      const [retry] = await ctx.db.select({ id: generations.id }).from(generations).where(eq(generations.parentGenerationId, failed.id)).limit(1);
      if (retry) throw new TRPCError({ code: "BAD_REQUEST", message: ALREADY_RELAUNCHED });
      const { adapter, model } = pickLaunchAdapter(ctx.catalog, failed.modelKey);
      // Two relaunches at once both pass the check above: the unique index on
      // parentGenerationId lets one insert through, before any model call.
      return launchGeneration(ctx.db, {
        projectId: input.projectId,
        scriptId: failed.scriptId,
        adapter,
        tier: "draft",
        durationS: failed.durationS,
        resolution: failed.resolution,
        language: failed.language ?? undefined,
        timeoutS: model.timeoutS,
        estimatedCostUsd: estimateCostUsd(model, failed.durationS),
        parentGenerationId: failed.id,
      }).catch((error: unknown) => {
        if (violates(error, "generation_one_relaunch_idx")) throw new TRPCError({ code: "BAD_REQUEST", message: ALREADY_RELAUNCHED });
        throw error;
      });
    }),

  launchText: projectProcedure
    .input(
      z.object({
        scriptId: z.string().uuid(),
        modelKey: MODEL_KEY,
        durationS: z.number().int().positive(),
        resolution: z.string().min(1),
        audio: z.boolean().optional(),
        language: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertScriptInProject(ctx.db, input.scriptId, input.projectId);
      return launchText(ctx, input);
    }),
});
