import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { listActors } from "~/modules/actors";

// The synthetic actor library, each actor with the URL of its front portrait
// (null without one: the app shows the initials).
export const actorsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ gender: z.string().optional(), ageRange: z.string().optional(), style: z.string().optional() }).optional())
    .query(async ({ ctx, input }) =>
      (await listActors(ctx.db, input ?? {})).map((actor) => ({ ...actor, portraitUrl: actor.portraitPath ? ctx.media.pictureUrl(actor.portraitPath) : null })),
    ),
});
