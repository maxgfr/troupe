import { z } from "zod";

import { createTRPCRouter, projectProcedure, workspaceProcedure } from "~/server/api/trpc";
import { getBenchmarkRun, listBenchmarkRuns, startBenchmark, voteOnEntry } from "~/modules/benchmark";
import { reconcileDueJobs } from "~/modules/generation";
import { estimateCostUsd } from "~/modules/models";
import { pickLaunchAdapter } from "./_adapters";
import { MODEL_KEY } from "./generation";
import { assertRunInWorkspace, assertScriptInProject } from "./_scope";

// The SAME script rendered by each selected model, side by side, with votes.
export const benchmarkRouter = createTRPCRouter({
  start: projectProcedure
    .input(
      z.object({
        scriptId: z.string().uuid(),
        modelKeys: z
          .array(MODEL_KEY)
          .min(2)
          .max(3)
          .refine((keys) => new Set(keys).size === keys.length, "Choose different models"),
        durationS: z.number().int().positive(),
        resolution: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertScriptInProject(ctx.db, input.scriptId, input.projectId);
      const picked = input.modelKeys.map((key) => pickLaunchAdapter(ctx.catalog, key));
      return startBenchmark(ctx.db, {
        projectId: input.projectId,
        scriptId: input.scriptId,
        models: picked.map(({ adapter, model }) => ({
          adapter,
          timeoutS: model.timeoutS,
          estimatedCostUsd: estimateCostUsd(model, input.durationS),
        })),
        durationS: input.durationS,
        resolution: input.resolution,
      });
    }),

  // The workspace's runs, newest first; bounded page + createdAt cursor.
  list: workspaceProcedure.input(z.object({ before: z.coerce.date().optional() })).query(async ({ ctx, input }) => {
    const runs = await listBenchmarkRuns(ctx.db, input.workspaceId, { before: input.before });
    const labels = new Map(ctx.catalog.models.map((m) => [m.key, m.label]));
    return runs.map((run) => ({
      ...run,
      winnerLabel: run.winnerModelKey ? (labels.get(run.winnerModelKey) ?? run.winnerModelKey) : null,
    }));
  }),

  get: workspaceProcedure.input(z.object({ runId: z.string().uuid() })).query(async ({ ctx, input }) => {
    await assertRunInWorkspace(ctx.db, input.runId, input.workspaceId);
    if (ctx.ingest) await reconcileDueJobs(ctx.db, { adapters: ctx.catalog.adapters, ingest: ctx.ingest, limit: 1 });
    const run = await getBenchmarkRun(ctx.db, input.runId, ctx.media);
    const labels = new Map(ctx.catalog.models.map((m) => [m.key, m.label]));
    return { ...run, entries: run.entries.map((e) => ({ ...e, label: labels.get(e.modelKey) ?? e.modelKey })) };
  }),

  vote: workspaceProcedure
    .input(z.object({ runId: z.string().uuid(), entryId: z.string().uuid(), score: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await assertRunInWorkspace(ctx.db, input.runId, input.workspaceId);
      return voteOnEntry(ctx.db, { entryId: input.entryId, userId: ctx.userId, score: input.score });
    }),
});
