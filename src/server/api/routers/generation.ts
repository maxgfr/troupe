import { z } from "zod";

import { createTRPCRouter, projectProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { generations, launchGeneration, listGenerationsForProject, reconcileDueJobs } from "~/modules/generation";
import { estimateCostUsd } from "~/modules/models";
import { pickLaunchAdapter } from "./_adapters";
import { assertGenerationInProject, assertScriptInProject } from "./_scope";

export const MODEL_KEY = z.string().min(1).max(80);
const TIER = z.enum(["draft", "final"]);

export const generationRouter = createTRPCRouter({
  // The project's launch timeline, newest first.
  forProject: projectProcedure.query(async ({ ctx, input }) => {
    // Polling while the monitor is open also makes pnpm dev self-contained.
    // The background worker continues the same queue after the browser closes.
    if (ctx.ingest) await reconcileDueJobs(ctx.db, { adapters: ctx.catalog.adapters, ingest: ctx.ingest, limit: 1 });
    const rows = await listGenerationsForProject(ctx.db, input.projectId);
    const labels = new Map(ctx.catalog.models.map((m) => [m.key, m.label]));
    return rows.map((row) => ({
      ...row,
      modelLabel: labels.get(row.modelKey) ?? row.modelId,
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
      const { adapter, model } = pickLaunchAdapter(ctx.catalog, failed.modelKey);
      return launchGeneration(ctx.db, {
        projectId: input.projectId,
        scriptId: failed.scriptId,
        adapter,
        tier: failed.tier,
        durationS: failed.durationS,
        resolution: failed.resolution,
        language: failed.language ?? undefined,
        timeoutS: model.timeoutS,
        estimatedCostUsd: estimateCostUsd(model, failed.durationS),
      });
    }),

  launchText: projectProcedure
    .input(
      z.object({
        scriptId: z.string().uuid(),
        modelKey: MODEL_KEY,
        tier: TIER,
        durationS: z.number().int().positive(),
        resolution: z.string().min(1),
        audio: z.boolean().optional(),
        language: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertScriptInProject(ctx.db, input.scriptId, input.projectId);
      const { adapter, model } = pickLaunchAdapter(ctx.catalog, input.modelKey);
      return launchGeneration(ctx.db, {
        projectId: input.projectId,
        scriptId: input.scriptId,
        adapter,
        tier: input.tier,
        durationS: input.durationS,
        resolution: input.resolution,
        audio: input.audio,
        language: input.language,
        timeoutS: model.timeoutS,
        estimatedCostUsd: estimateCostUsd(model, input.durationS),
      });
    }),
});
