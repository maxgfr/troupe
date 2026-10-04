import { createCallerFactory, createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { identityRouter } from "~/server/api/routers/identity";
import { studioRouter } from "~/server/api/routers/studio";
import { actorsRouter } from "~/server/api/routers/actors";
import { scriptRouter } from "~/server/api/routers/script";
import { generationRouter } from "~/server/api/routers/generation";
import { benchmarkRouter } from "~/server/api/routers/benchmark";
import { exportRouter } from "~/server/api/routers/export";
import { opsRouter } from "~/server/api/routers/ops";
import { settingsRouter } from "~/server/api/routers/settings";
import { chatRouter } from "~/server/api/routers/chat";

// One router per module (ADR module boundary). Each procedure is workspace- or
// project-scoped and fails closed for non-members.
export const appRouter = createTRPCRouter({
  health: publicProcedure.query(() => "ok" as const),
  identity: identityRouter,
  studio: studioRouter,
  actors: actorsRouter,
  script: scriptRouter,
  generation: generationRouter,
  benchmark: benchmarkRouter,
  export: exportRouter,
  ops: opsRouter,
  settings: settingsRouter,
  chat: chatRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
