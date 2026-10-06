import { eq, inArray } from "drizzle-orm";

import { generations, ingestRender, mediaAssets, type RenderIngestor } from "~/modules/generation";
import type { Db } from "~/server/db/types";
import { saveMediaFile } from "../media";
import { knownJob, pruneJobs, type JobSettlement } from "./jobs";

// The browser edition's counterpart of persistProviderRender
// (src/server/media/storage.ts), in two steps around the reconcile
// transaction of a database every tab shares.
//
// Inside it, the ingest only records the render, from what the page found when
// the render ended (runner.ts read the file back with a <video> and hashed
// it) and the adapter's status check just read (knownJob): no IndexedDB, no
// probe. After it commits, keepSettledRenders stores the file under the asset
// the database recorded, where the media service worker serves it, then
// forgets the job. A rolled-back commit leaves no file and keeps the job, so
// the next poll records it again.
//
// A reconciling call's result never points the page at a render before its
// file is stored: the browser edition's tRPC client (site/src/trpc.tsx) runs
// keepSettledRenders before it hands that result over. Other reads
// (benchmark.list, an export) do not wait: for the moment between another
// tab's commit and that tab storing the file, they can list a render whose
// file the media service worker does not have yet (it answers 404 until then).

export const ingestBrowserRender: RenderIngestor = async (db, gen, status) => {
  if (gen.outputAssetId) return;
  const job = knownJob(status.providerJobId);
  // getJob read the job just before, in this tab; without it, the next poll retries.
  if (!job?.probe || !job.checksum || !job.video)
    throw new Error("The finished render's details have not been read yet.");
  await ingestRender(db, {
    generationId: gen.id,
    bytes: job.video.size,
    checksum: job.checksum,
    probe: async () => ({ ...job.probe, storage: "indexeddb" }),
  });
};

// Whether the studio is done with each job: settled once its render is
// recorded (with the file to keep) or failed; jobs it has no record of are
// left out.
export async function settledBrowserJobs(db: Db, jobIds: string[]): Promise<Map<string, JobSettlement>> {
  if (jobIds.length === 0) return new Map();
  const rows = await db
    .select({
      providerJobId: generations.providerJobId,
      status: generations.status,
      assetId: mediaAssets.id,
      storagePath: mediaAssets.storagePath,
    })
    .from(generations)
    .leftJoin(mediaAssets, eq(mediaAssets.id, generations.outputAssetId))
    .where(inArray(generations.providerJobId, jobIds));
  return new Map(
    rows.map((row): [string, JobSettlement] => [
      row.providerJobId!,
      row.assetId && row.storagePath
        ? { state: "settled", file: { assetId: row.assetId, storagePath: row.storagePath } }
        : row.status === "failed"
          ? { state: "settled" }
          : { state: "pending" },
    ]),
  );
}

// After a reconciling call committed: keep the files of the renders it
// recorded, then forget their jobs.
export function keepSettledRenders(db: Db): Promise<void> {
  return pruneJobs(
    (ids) => settledBrowserJobs(db, ids),
    ({ assetId, storagePath }, blob) => saveMediaFile({ id: assetId, storagePath, blob }),
  );
}
