import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, workspaceProcedure } from "~/server/api/trpc";
import { AdapterError, generations, launchShot, prepareShot, reconcileDueJobs, shotActor } from "~/modules/generation";
import { estimateCostUsd, estimateMediaUsd, type Medium, type ResolvedModel } from "~/modules/models";
import type { Db } from "~/server/db/types";
import { loadMediaModels, mediaApiKey } from "~/server/media-catalog";
import { renderMediaShot } from "~/server/shot-media";
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

// The photo or voice models chosen, each with the key it renders on; refused
// as a whole when one cannot render.
async function pickMedia(db: Db, keys: string[], medium: Medium) {
  const all = await loadMediaModels(db);
  return Promise.all(
    keys.map(async (key) => {
      const model = all.find((m) => m.key === key && m.medium === medium && !m.archived);
      if (!model)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unknown ${medium === "image" ? "photo" : "voice"} model "${key}".`,
        });
      const apiKey = model.status === "ready" ? await mediaApiKey(db, model.credential) : null;
      if (!apiKey)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${model.label} cannot render yet: ${model.statusDetail ?? "add its key in Settings"}.`,
        });
      return { model, apiKey };
    }),
  );
}

// A photo of an actor: their look follows the description, as for videos.
async function withActor(db: Db, text: string, actorId: string | null | undefined, workspaceId: string) {
  if (!actorId) return text;
  const actor = await shotActor(db, actorId, workspaceId);
  return `${text}\n\nOn screen: ${actor.look}.`;
}

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
      const media = await loadMediaModels(ctx.db);
      const labels = new Map([...ctx.catalog.models, ...media].map((m) => [m.key, m.label]));
      const relaunched = new Set(rows.map((r) => r.parentGenerationId).filter(Boolean));
      return rows.map((row) => ({
        id: row.id,
        medium: row.medium,
        options: row.options,
        mimeType: row.mimeType,
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

  // The photo and voice models the page can offer, with why one cannot
  // render yet.
  mediaModels: workspaceProcedure.query(async ({ ctx }) =>
    (await loadMediaModels(ctx.db)).filter((m) => !m.archived).map((m) => ({ ...m, available: m.status === "ready" })),
  ),

  // Draw the description as photos: `count` on each chosen model, each its
  // own shot, rendered while the launch waits.
  launchPhoto: workspaceProcedure
    .input(
      z.object({
        modelKeys: z.array(MODEL_KEY).min(1).max(SHOT_MAX_MODELS),
        text: z.string().trim().min(1, "Describe the photo before launching it.").max(SHOT_MAX_CHARS),
        aspectRatio: z.string().min(1).max(10),
        count: z.number().int().min(1).max(SHOT_MAX_COUNT).default(1),
        actorId: z.string().uuid().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.modelKeys.length * input.count > SHOT_MAX_RENDERS)
        throw new TRPCError({ code: "BAD_REQUEST", message: `At most ${SHOT_MAX_RENDERS} photos per launch.` });
      const chosen = await pickMedia(ctx.db, input.modelKeys, "image");
      const text = await withActor(ctx.db, input.text, input.actorId, input.workspaceId).catch(asBadRequest);
      const projectId = await ensureShotsProject(ctx.db, input.workspaceId);
      const runs = chosen.flatMap((c) =>
        Array.from({ length: input.count }, () =>
          renderMediaShot(ctx.db, {
            projectId,
            model: c.model,
            apiKey: c.apiKey,
            text,
            image: { aspectRatio: input.aspectRatio },
            estimatedCostUsd: estimateMediaUsd(c.model, { images: 1 }),
            actorId: input.actorId,
          }),
        ),
      );
      const done = await Promise.all(runs);
      return done.map((g) => ({ id: g.id, modelKey: g.modelKey, status: g.status, errorDetail: g.errorDetail }));
    }),

  // Say the text with a voice, on one model.
  launchVoice: workspaceProcedure
    .input(
      z.object({
        modelKey: MODEL_KEY,
        text: z.string().trim().min(1, "Write what the voice says before launching it.").max(SHOT_MAX_CHARS),
        voice: z.string().max(200).nullish(),
        language: z.string().max(20).nullish(),
        instructions: z.string().max(500).nullish(),
        actorId: z.string().uuid().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [chosen] = await pickMedia(ctx.db, [input.modelKey], "speech");
      const model = chosen!.model;
      if (input.voice && model.voices && !model.voices.some((v) => v.id === input.voice))
        throw new TRPCError({ code: "BAD_REQUEST", message: `${model.label} has no voice ${input.voice}.` });
      // An actor's delivery becomes the instructions of a model that takes some.
      const actor = input.actorId
        ? await shotActor(ctx.db, input.actorId, input.workspaceId).catch(asBadRequest)
        : null;
      const instructions = [input.instructions, actor?.voiceProfile].filter(Boolean).join(" ") || undefined;
      const projectId = await ensureShotsProject(ctx.db, input.workspaceId);
      const gen = await renderMediaShot(ctx.db, {
        projectId,
        model,
        apiKey: chosen!.apiKey,
        text: input.text,
        speech: {
          ...(input.voice ? { voice: input.voice } : {}),
          ...(input.language ? { language: input.language } : {}),
          ...(instructions ? { instructions } : {}),
        },
        estimatedCostUsd: estimateMediaUsd(model, { characters: input.text.length }),
        actorId: input.actorId,
      });
      return [{ id: gen.id, modelKey: gen.modelKey, status: gen.status, errorDetail: gen.errorDetail }];
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
    if (failed.medium !== "video") {
      const [chosen] = await pickMedia(ctx.db, [failed.modelKey], failed.medium);
      const options = (failed.options ?? {}) as Record<string, string | undefined>;
      const gen = await renderMediaShot(ctx.db, {
        projectId,
        model: chosen!.model,
        apiKey: chosen!.apiKey,
        text: failed.prompt,
        ...(failed.medium === "image"
          ? { image: { aspectRatio: failed.aspectRatio, ...(options.size ? { size: options.size } : {}) } }
          : { speech: { voice: options.voice, language: options.language, instructions: options.instructions } }),
        estimatedCostUsd: estimateMediaUsd(chosen!.model, { images: 1, characters: failed.prompt.length }),
        actorId: failed.actorId,
        parentGenerationId: failed.id,
      }).catch((error: unknown) => {
        if (violates(error, "generation_one_relaunch_idx"))
          throw new TRPCError({ code: "BAD_REQUEST", message: ALREADY_RELAUNCHED });
        throw error;
      });
      return { id: gen.id, status: gen.status };
    }
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
