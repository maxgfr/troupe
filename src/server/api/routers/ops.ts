import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { getReconcileHeartbeat } from "~/server/jobs/heartbeat";

// The reconciler's liveness beacon. It carries no workspace
// data — a timestamp and a processed count — so it stays public: a self-hosted
// operator can confirm the safety net is alive from Workspace Settings
// even before Supabase Auth is provisioned.
export const opsRouter = createTRPCRouter({
  reconcileHeartbeat: publicProcedure.query(({ ctx }) => getReconcileHeartbeat(ctx.db)),
});
