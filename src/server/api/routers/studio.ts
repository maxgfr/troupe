import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, projectProcedure, protectedProcedure, workspaceProcedure } from "~/server/api/trpc";
import { changeProjectActor, createProjectFromWizard, formatOptionsFor, getProject, modelOptionsFor, updateProjectChoices } from "~/modules/studio";
import type { ModelCatalog } from "~/modules/models";
import { MODEL_KEY } from "./generation";
import { deleteProjectData } from "~/server/projects";

const PLATFORM = z.enum(["instagram", "youtube", "tiktok", "linkedin"]);
const FORMAT = z.enum(["9:16", "1:1", "16:9"]);

function assertKnownModel(catalog: ModelCatalog, modelKey: string | null | undefined) {
  if (modelKey && !catalog.models.some((m) => m.key === modelKey)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Unknown model "${modelKey}".` });
  }
}

// The guided creation wizard + which models fit a format and language.
export const studioRouter = createTRPCRouter({
  formatOptions: protectedProcedure
    .input(z.object({ platform: PLATFORM }))
    .query(({ input }) => formatOptionsFor(input.platform)),

  modelOptions: protectedProcedure
    .input(z.object({ format: FORMAT.optional(), language: z.string().max(20).optional() }))
    .query(({ ctx, input }) => ({
      models: modelOptionsFor(ctx.catalog.models, input),
      defaultModelKey: ctx.catalog.defaultModelKey,
    })),

  getProject: projectProcedure.query(({ ctx, input }) => getProject(ctx.db, input.projectId)),

  createFromWizard: workspaceProcedure
    .input(z.object({ title: z.string().trim().min(1).max(200), platform: PLATFORM, format: FORMAT, language: z.string().min(1).max(20), actorId: z.string().uuid(), modelKey: MODEL_KEY.nullish() }))
    .mutation(({ ctx, input }) => {
      assertKnownModel(ctx.catalog, input.modelKey);
      return createProjectFromWizard(ctx.db, input);
    }),

  // Deletes the project with its scripts, renders and video files.
  deleteProject: projectProcedure.mutation(async ({ ctx, input }) => {
    const { files } = await deleteProjectData(ctx.db, input.projectId);
    try {
      await ctx.media.remove(files);
    } catch (error) {
      console.error(JSON.stringify({ event: "media.remove.failed", projectId: input.projectId, message: (error as Error).message }));
    }
    return { deleted: true };
  }),

  updateChoices: projectProcedure
    .input(z.object({ title: z.string().trim().min(1).max(200).optional(), format: FORMAT.optional(), platform: PLATFORM.optional(), language: z.string().optional(), modelKey: MODEL_KEY.nullish() }))
    .mutation(({ ctx, input }) => {
      assertKnownModel(ctx.catalog, input.modelKey);
      return updateProjectChoices(ctx.db, input);
    }),

  // Recast the project; renders already made keep the actor they were made with.
  changeActor: projectProcedure
    .input(z.object({ actorId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await changeProjectActor(ctx.db, input);
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: (error as Error).message });
      }
    }),
});
