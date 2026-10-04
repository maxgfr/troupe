import "server-only";

import { reconcileDueJobs } from "~/modules/generation";
import { loadModelCatalog } from "~/server/adapters";
import { db as runtimeDb } from "~/server/db";
import type { Db } from "~/server/db/types";
import { persistProviderRender } from "~/server/media/storage";
import { recordReconcileHeartbeat } from "./heartbeat";

// One reconciliation pass: poll due jobs, save finished videos, stamp the
// heartbeat Settings shows.
export async function reconcileOnce(db: Db = runtimeDb as unknown as Db, limit = 10) {
  const { adapters } = await loadModelCatalog(db);
  const results = await reconcileDueJobs(db, { adapters, ingest: persistProviderRender, limit });
  if (results.length) {
    const counts: Record<string, number> = {};
    for (const r of results) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
    console.info(JSON.stringify({ event: "jobs.reconcile", processed: results.length, counts }));
  }
  await recordReconcileHeartbeat(db, { at: new Date(), processed: results.length });
  return results;
}

export { startLoop } from "./loop";
