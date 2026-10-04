import type { NextRequest } from "next/server";

import { env } from "~/env";
import { persistProviderRender } from "~/server/media/storage";
import { db } from "~/server/db";
import type { Db } from "~/server/db/types";
import { reconcileDueJobs } from "~/modules/generation";
import { loadModelCatalog } from "~/server/adapters";
import { processReconcileRequest } from "~/server/jobs/reconcile";
import { recordReconcileHeartbeat } from "~/server/jobs/heartbeat";

// Polling-fallback trigger. Schedule a POST here every
// minute (pg_cron, Vercel cron, curl loop) with the x-reconcile-secret header.
export async function POST(req: NextRequest) {
  const result = await processReconcileRequest(
    {
      orchestrator: {
        reconcileDue: async (input) => reconcileDueJobs(db as unknown as Db, { adapters: (await loadModelCatalog()).adapters, ingest: persistProviderRender, ...input }),
      },
      secret: env.RECONCILE_SECRET,
      // Stamp the liveness beacon so Workspace Settings can prove the
      // scheduler is alive (or warn when it goes stale).
      recordHeartbeat: (run) => recordReconcileHeartbeat(db as unknown as Db, run),
    },
    { secret: req.headers.get("x-reconcile-secret") },
  );
  return Response.json(result.body, { status: result.status });
}
