import { and, desc, eq, inArray, notExists, sql } from "drizzle-orm";

import type { Db } from "~/server/db/types";
import type { StoredFile } from "~/server/media/store";
import { benchmarkEntries, benchmarkRuns } from "~/modules/benchmark";
import { generations, mediaAssets } from "~/modules/generation";
import { exportRecords } from "~/modules/export";
import { projectStage, projects, type ProjectStage } from "~/modules/studio";

// A workspace's projects, newest first, each with the stage it is at
// (studio/stage.ts), worked out from its renders and exports.
export async function listProjects(db: Db, workspaceId: string) {
  const rows = await db.select().from(projects).where(eq(projects.workspaceId, workspaceId)).orderBy(desc(projects.createdAt));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const renders = await db
    .select({
      projectId: generations.projectId,
      running: sql<number>`count(*) filter (where ${generations.status} in ('queued', 'in_progress'))::int`,
      finished: sql<number>`count(*) filter (where ${generations.status} = 'completed')::int`,
    })
    .from(generations)
    .where(inArray(generations.projectId, ids))
    .groupBy(generations.projectId);
  const exported = await db
    .select({ projectId: exportRecords.projectId, n: sql<number>`count(*)::int` })
    .from(exportRecords)
    .where(inArray(exportRecords.projectId, ids))
    .groupBy(exportRecords.projectId);
  const byProject = new Map(renders.map((r) => [r.projectId, r]));
  const exports = new Map(exported.map((e) => [e.projectId, e.n]));
  return rows.map((row) => ({
    ...row,
    status: projectStage({
      stored: row.status as ProjectStage,
      running: byProject.get(row.id)?.running ?? 0,
      finished: byProject.get(row.id)?.finished ?? 0,
      exported: exports.get(row.id) ?? 0,
    }),
  }));
}

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
