import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, workspaceProcedure } from "~/server/api/trpc";
import { AdapterError, generations, launchShot, prepareShot, reconcileDueJobs } from "~/modules/generation";
import { estimateCostUsd, type ResolvedModel } from "~/modules/models";
import { modelOptionsFor } from "~/modules/studio";
import { deleteShots, ensureShotsProject, favoriteShot, listShots, ShotBusyError } from "~/server/shots";
import { pickLaunchAdapter } from "./_adapters";
import { MODEL_KEY, violates } from "./generation";

// The longest shot description a launch accepts; a model with its own,
// shorter limit says so in its capabilities.
export const SHOT_MAX_CHARS = 4000;

// At most this many renders of the same shot per model and launch.
export const SHOT_MAX_COUNT = 4;

// At most this many models side by side, and renders in all, per launch.
export const SHOT_MAX_MODELS = 4;
export const SHOT_MAX_RENDERS = 8;

// Only the in-browser renderer voices a script line by line; every other
// model renders a description.
const needsScript = (m: Pick<ResolvedModel, "family">) => m.family === "browser";

const ALREADY_RELAUNCHED = "This shot was already relaunched. Follow the newer one in the gallery.";

function asBadRequest(error: unknown): never {
  if (error instanceof AdapterError || error instanceof ShotBusyError)
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  throw error;
}

const SHOT_SETTINGS = z.object({
  // One model, or a few side by side: the same shot on each.
  modelKeys: z
    .array(MODEL_KEY)
    .min(1, "Choose a model.")
    .max(SHOT_MAX_MODELS, `Choose at most ${SHOT_MAX_MODELS} models.`)
    .refine((keys) => new Set(keys).size === keys.length, "Each model once."),
  aspectRatio: z.string().min(1).max(10),
  durationS: z.number().int().positive(),
  resolution: z.string().min(1).max(20),
  audio: z.boolean().optional(),
  actorId: z.string().uuid().nullish(),
});

// The Shots page: free-form renders from one text field, no project or
// script. Its renders live in the workspace's hidden Shots project.
export const shotsRouter = createTRPCRouter({
  // Every model the page can offer, with why one cannot launch yet.
  models: workspaceProcedure.query(({ ctx }) => {
    const byKey = new Map(ctx.catalog.models.map((m) => [m.key, m]));
    return {
      defaultModelKey: ctx.catalog.defaultModelKey,
      models: modelOptionsFor(ctx.catalog.models, {}).map((option) => {
        const model = byKey.get(option.key)!;
        const script = needsScript(model);
        return {
          ...option,
          credential: model.credential,
          status: model.status,
          promptMaxChars: SHOT_MAX_CHARS,
          needsScript: script,
          available: option.available && !script,
          unavailableReason: script
            ? `${model.label} voices a script line by line. Launch it from a project.`
            : option.unavailableReason,
        };
      }),
    };
  }),

  // The gallery, newest first, one page at a time.
  list: workspaceProcedure
    .input(
      z.object({
        favorites: z.boolean().optional(),
        before: z.date().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Polling the open gallery keeps pnpm dev self-contained, as the
      // project timeline does.
      if (ctx.ingest) await reconcileDueJobs(ctx.db, { adapters: ctx.catalog.adapters, ingest: ctx.ingest, limit: 1 });
      const projectId = await ensureShotsProject(ctx.db, input.workspaceId);
      const rows = await listShots(ctx.db, projectId, { favorites: input.favorites, before: input.before });
      const labels = new Map(ctx.catalog.models.map((m) => [m.key, m.label]));
      const relaunched = new Set(rows.map((r) => r.parentGenerationId).filter(Boolean));
      return rows.map((row) => ({
        id: row.id,
        modelKey: row.modelKey,
        modelLabel: labels.get(row.modelKey) ?? row.modelId,
        prompt: row.prompt,
        aspectRatio: row.aspectRatio,
        durationS: row.durationS,
        resolution: row.resolution,
        actorId: row.actorId,
        status: row.status,
        progress: row.progress,
        costUsd: row.costUsd,
        costSource: row.costSource,
        errorCode: row.errorCode,
        errorDetail: row.errorDetail,
        favorite: row.favoritedAt !== null,
        relaunched: relaunched.has(row.id),
        width: row.width,
        height: row.height,
        videoDurationS: row.videoDurationS,
        createdAt: row.createdAt,
        completedAt: row.completedAt,
        videoUrl: row.outputAssetId ? ctx.media.urlFor(row.outputAssetId) : null,
        downloadUrl: row.outputAssetId ? ctx.media.urlFor(row.outputAssetId, { download: true }) : null,
      }));
    }),

  // Render the shot `count` times on each chosen model, each its own render.
  // Every model and setting is checked before the first model is called, so
  // a refusal never leaves half a launch behind.
  launch: workspaceProcedure
    .input(
      SHOT_SETTINGS.extend({
        text: z.string().trim().min(1, "Describe the shot before launching it.").max(SHOT_MAX_CHARS),
        count: z.number().int().min(1).max(SHOT_MAX_COUNT).default(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.modelKeys.length * input.count > SHOT_MAX_RENDERS)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `At most ${SHOT_MAX_RENDERS} renders per launch. Choose fewer models or fewer renders.`,
        });
      const chosen = input.modelKeys.map((key) => {
        const picked = pickLaunchAdapter(ctx.catalog, key);
        if (needsScript(picked.model))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${picked.model.label} voices a script line by line. Launch it from a project.`,
          });
        return picked;
      });
      const projectId = await ensureShotsProject(ctx.db, input.workspaceId);
      const shots = chosen.map(({ adapter, model }) => ({
        label: model.label,
        modelKey: model.key,
        input: {
          projectId,
          text: input.text,
          adapter,
          aspectRatio: input.aspectRatio,
          durationS: input.durationS,
          resolution: input.resolution,
          // Sound is a choice only where the model offers one; elsewhere the
          // model's own rule applies.
          audio: adapter.capabilities().audio === "optional" ? input.audio : undefined,
          actorId: input.actorId,
          timeoutS: model.timeoutS,
          estimatedCostUsd: estimateCostUsd(model, input.durationS),
        },
      }));
      for (const shot of shots) {
        await prepareShot(ctx.db, shot.input).catch((error: unknown) => {
          // Side by side, say which model refused.
          if (error instanceof AdapterError && shots.length > 1)
            throw new TRPCError({ code: "BAD_REQUEST", message: `${shot.label}: ${error.message}` });
          return asBadRequest(error);
        });
      }
      const launched = [];
      for (let i = 0; i < input.count; i++) {
        for (const shot of shots) {
          const gen = await launchShot(ctx.db, shot.input).catch(asBadRequest);
          launched.push({ id: gen.id, modelKey: shot.modelKey, status: gen.status, errorDetail: gen.errorDetail });
        }
      }
      return launched;
    }),

  // Try a failed shot again with the same text, model and settings, once.
  relaunch: workspaceProcedure.input(z.object({ generationId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const projectId = await ensureShotsProject(ctx.db, input.workspaceId);
    const [failed] = await ctx.db
      .select()
      .from(generations)
      .where(and(eq(generations.id, input.generationId), eq(generations.projectId, projectId)))
      .limit(1);
    if (!failed) throw new TRPCError({ code: "NOT_FOUND", message: "This shot no longer exists." });
    if (failed.status !== "failed")
      throw new TRPCError({ code: "BAD_REQUEST", message: "Only a failed shot can be relaunched." });
    const [retry] = await ctx.db
      .select({ id: generations.id })
      .from(generations)
      .where(eq(generations.parentGenerationId, failed.id))
      .limit(1);
    if (retry) throw new TRPCError({ code: "BAD_REQUEST", message: ALREADY_RELAUNCHED });
    const { adapter, model } = pickLaunchAdapter(ctx.catalog, failed.modelKey);
    // The stored prompt already carries the actor's description.
    const gen = await launchShot(ctx.db, {
      projectId,
      text: failed.prompt,
      adapter,
      aspectRatio: failed.aspectRatio,
      durationS: failed.durationS,
      resolution: failed.resolution,
      timeoutS: model.timeoutS,
      estimatedCostUsd: estimateCostUsd(model, failed.durationS),
      parentGenerationId: failed.id,
    }).catch((error: unknown) => {
      if (violates(error, "generation_one_relaunch_idx"))
        throw new TRPCError({ code: "BAD_REQUEST", message: ALREADY_RELAUNCHED });
      return asBadRequest(error);
    });
    return { id: gen.id, status: gen.status };
  }),

  favorite: workspaceProcedure
    .input(z.object({ generationId: z.string().uuid(), on: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const projectId = await ensureShotsProject(ctx.db, input.workspaceId);
      const row = await favoriteShot(ctx.db, projectId, input.generationId, input.on);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "This shot no longer exists." });
      return { id: row.id, favorite: row.favoritedAt !== null };
    }),

  // Delete shots with their video files.
  delete: workspaceProcedure
    .input(z.object({ generationIds: z.array(z.string().uuid()).min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const projectId = await ensureShotsProject(ctx.db, input.workspaceId);
      const { deleted, files } = await deleteShots(ctx.db, projectId, input.generationIds).catch(asBadRequest);
      try {
        await ctx.media.remove(files);
      } catch (error) {
        console.error(JSON.stringify({ event: "media.remove.failed", projectId, message: (error as Error).message }));
      }
      return { deleted };
    }),
});
