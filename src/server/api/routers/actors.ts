import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure, workspaceProcedure } from "~/server/api/trpc";
import { listActors } from "~/modules/actors";
import { listWorkspacesFor } from "~/modules/identity";
import { estimateMediaUsd, type MediaModel } from "~/modules/models";
import type { Db } from "~/server/db/types";
import {
  ACTOR_PICTURE_COUNT,
  ActorCreateError,
  ActorInUseError,
  createActor,
  DEFAULT_ACTOR_PHOTO_MODEL,
  deleteCustomActor,
  drawsFromReference,
} from "~/server/actor-create";
import {
  addMediaModel,
  listMediaModels,
  loadMediaModels,
  mediaApiKey,
  mediaCatalogKeys,
  mediaModelKey,
} from "~/server/media-catalog";

const DEFAULT_KEY = mediaModelKey("image", DEFAULT_ACTOR_PHOTO_MODEL.provider, DEFAULT_ACTOR_PHOTO_MODEL.id);

// The photo models an actor can be made with: those that draw from a
// reference picture (OpenRouter's).
async function actorPhotoModels(db: Db) {
  return (await loadMediaModels(db)).filter((m) => m.medium === "image" && !m.archived && drawsFromReference(m));
}

// The chosen model, else the first ready one, else the default added on the
// spot when the OpenRouter key is set.
async function pickPhotoModel(db: Db, key: string | undefined): Promise<{ model: MediaModel; apiKey: string }> {
  let models = await actorPhotoModels(db);
  let model = key ? models.find((m) => m.key === key) : models.find((m) => m.status === "ready");
  if (key && !model) {
    const any = (await loadMediaModels(db)).find((m) => m.key === key);
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: any
        ? `${any.label} cannot draw the same person twice. Choose a photo model on OpenRouter.`
        : `Unknown photo model "${key}".`,
    });
  }
  if (!model && (await mediaApiKey(db, "openrouter"))) {
    const listed = await listMediaModels("image", await mediaCatalogKeys(db));
    await addMediaModel(db, { medium: "image", ...DEFAULT_ACTOR_PHOTO_MODEL, models: listed });
    models = await actorPhotoModels(db);
    model = models.find((m) => m.key === DEFAULT_KEY);
  }
  if (!model)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Making an actor needs an OpenRouter key: add it in Settings (or troupe keys set openrouter), then try again.",
    });
  const apiKey = model.status === "ready" ? await mediaApiKey(db, model.credential) : null;
  if (!apiKey)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `${model.label} cannot draw yet: ${model.statusDetail ?? "add its key in Settings"}.`,
    });
  return { model, apiKey };
}

const NAME = z.string().trim().min(1, "Give the actor a name.").max(60);

// The synthetic actor library, plus the actors made in the caller's
// workspaces, each with the URL of its front portrait (null without one:
// the app shows the initials).
export const actorsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z
        .object({ gender: z.string().optional(), ageRange: z.string().optional(), style: z.string().optional() })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const workspaceIds = (await listWorkspacesFor(ctx.db, ctx.userId)).map((w) => w.id);
      return (await listActors(ctx.db, input ?? {}, { workspaceIds })).map((actor) => ({
        ...actor,
        custom: actor.workspaceId !== null,
        portraitUrl: actor.portraitPath ? ctx.media.pictureUrl(actor.portraitPath) : null,
      }));
    }),

  // What making an actor would use and cost, before anything is drawn.
  createOptions: workspaceProcedure.query(async ({ ctx }) => {
    const models = await actorPhotoModels(ctx.db);
    const openrouterKey = Boolean(await mediaApiKey(ctx.db, "openrouter"));
    return {
      pictureCount: ACTOR_PICTURE_COUNT,
      openrouterKey,
      defaultModel: DEFAULT_ACTOR_PHOTO_MODEL,
      models: models.map((m) => ({
        key: m.key,
        label: m.label,
        available: m.status === "ready",
        statusDetail: m.statusDetail,
        estimatedCostUsd: estimateMediaUsd(m, { images: ACTOR_PICTURE_COUNT }),
      })),
    };
  }),

  // Draw a new actor from a description, on the user's own photo model key.
  // Takes the time of two pictures (the front, then the five others at once).
  create: workspaceProcedure
    .input(
      z.object({
        name: NAME,
        gender: z.enum(["female", "male", "nonbinary"]),
        ageRange: z.string().trim().min(1).max(20),
        style: z.string().trim().min(1).max(40),
        look: z.string().trim().min(10, "Describe what they look like: face, hair, clothes.").max(1000),
        voiceProfile: z.string().trim().min(3, "Describe how they speak.").max(200),
        modelKey: z.string().max(120).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { model, apiKey } = await pickPhotoModel(ctx.db, input.modelKey);
      try {
        const made = await createActor(ctx.db, {
          workspaceId: input.workspaceId,
          model,
          apiKey,
          description: {
            name: input.name,
            gender: input.gender,
            ageRange: input.ageRange,
            style: input.style,
            look: input.look,
            voiceProfile: input.voiceProfile,
          },
        });
        return {
          ...made.actor,
          custom: true,
          portraitUrl: made.actor.portraitPath ? ctx.media.pictureUrl(made.actor.portraitPath) : null,
          costUsd: made.costUsd,
          modelKey: model.key,
          modelLabel: model.label,
        };
      } catch (error) {
        if (error instanceof ActorCreateError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        throw error;
      }
    }),

  // Delete an actor made in this workspace (never one of the library's).
  delete: workspaceProcedure.input(z.object({ actorId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    try {
      const deleted = await deleteCustomActor(ctx.db, input.workspaceId, input.actorId);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "No actor made in this workspace has that id." });
      return { deleted: true };
    } catch (error) {
      if (error instanceof ActorInUseError) throw new TRPCError({ code: "CONFLICT", message: error.message });
      throw error;
    }
  }),
});
