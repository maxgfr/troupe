import { inArray } from "drizzle-orm";

import { generations, ingestRender, type RenderIngestor } from "~/modules/generation";
import type { Db } from "~/server/db/types";
import { saveMediaFile } from "../media";
import type { JobSettlement } from "./jobs";
import { readJob } from "./jobs";

// The demo's counterpart of persistProviderRender (src/server/media/storage.ts).
// It runs inside the reconcile transaction of a database every tab shares, so
// it only reads what the page found when the render ended (runner.ts checked
// the file with a <video> and hashed it), records the render and keeps its
// file in IndexedDB, where the media service worker serves it. The job, MP4
// included, stays until that transaction has committed (pruneJobs).

export const ingestBrowserRender: RenderIngestor = async (db, gen, status) => {
  if (gen.outputAssetId) return;
  const job = await readJob(status.providerJobId);
  if (!job?.video || !job.probe || !job.checksum) throw new Error("The finished video is no longer in this browser.");
  const render = await ingestRender(db, {
    generationId: gen.id,
    bytes: job.video.size,
    checksum: job.checksum,
    probe: async () => ({ ...job.probe, storage: "indexeddb" }),
  });
  // Keyed by the asset: if the transaction rolls back, the next poll writes
  // the file again under the asset it records then.
  await saveMediaFile({ id: render.id, storagePath: render.storagePath, blob: job.video });
};

// For pruneJobs: whether the studio is done with each job, read after the
// reconcile transaction committed. A render is settled once its file is
// recorded, or once it failed; jobs the studio has no record of are left out.
export async function settledBrowserJobs(db: Db, jobIds: string[]): Promise<Map<string, JobSettlement>> {
  if (jobIds.length === 0) return new Map();
  const rows = await db
    .select({ providerJobId: generations.providerJobId, status: generations.status, outputAssetId: generations.outputAssetId })
    .from(generations)
    .where(inArray(generations.providerJobId, jobIds));
  return new Map(rows.map((row) => [row.providerJobId!, row.outputAssetId || row.status === "failed" ? "settled" : "pending"]));
}
