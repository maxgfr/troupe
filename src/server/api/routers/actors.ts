import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { listActors } from "~/modules/actors";

// The synthetic actor library.
export const actorsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ gender: z.string().optional(), ageRange: z.string().optional(), style: z.string().optional() }).optional())
    .query(({ ctx, input }) => listActors(ctx.db, input ?? {})),
});
