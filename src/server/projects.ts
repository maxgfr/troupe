import { and, eq, inArray, notExists, sql } from "drizzle-orm";

import type { Db } from "~/server/db/types";
import type { StoredFile } from "~/server/media/store";
import { benchmarkEntries, benchmarkRuns } from "~/modules/benchmark";
import { generations, mediaAssets } from "~/modules/generation";
import { projects } from "~/modules/studio";

// Delete a project and everything only it owned: scripts, renders, exports
// and watches cascade from the project row; render media rows and
// comparisons left without entries are removed here. Returns the stored
// files for the caller to delete once the transaction has committed.
export async function deleteProjectData(db: Db, projectId: string): Promise<{ files: StoredFile[] }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: generations.id, outputAssetId: generations.outputAssetId })
      .from(generations)
      .where(eq(generations.projectId, projectId));
    const assetIds = rows.map((r) => r.outputAssetId).filter((id): id is string => Boolean(id));
    const assets = assetIds.length ? await tx.select().from(mediaAssets).where(inArray(mediaAssets.id, assetIds)) : [];
    const runIds = rows.length
      ? (await tx.selectDistinct({ id: benchmarkEntries.benchmarkRunId }).from(benchmarkEntries).where(inArray(benchmarkEntries.generationId, rows.map((r) => r.id)))).map((r) => r.id)
      : [];

    const deleted = await tx.delete(projects).where(eq(projects.id, projectId)).returning({ id: projects.id });
    if (deleted.length === 0) throw new Error("This project no longer exists.");
    if (assetIds.length) await tx.delete(mediaAssets).where(inArray(mediaAssets.id, assetIds));
    if (runIds.length) {
      await tx.delete(benchmarkRuns).where(and(
        inArray(benchmarkRuns.id, runIds),
        notExists(tx.select({ one: sql`1` }).from(benchmarkEntries).where(eq(benchmarkEntries.benchmarkRunId, benchmarkRuns.id))),
      ));
    }
    return {
      files: assets.map((a): StoredFile => ({ storagePath: a.storagePath, storage: a.meta.storage === "supabase" ? "supabase" : "local" })),
    };
  });
}
