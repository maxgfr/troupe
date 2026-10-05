import { desc, eq } from "drizzle-orm";

import type { Db } from "~/server/db/types";
import { projects } from "~/modules/studio/server/schema";
import { generations } from "./schema";
import { mediaAssets } from "./media";

export { launchGeneration } from "./launch";
export type { LaunchInput } from "./launch";

// Renders are probed on ingestion, then linked as the generation's output.
export async function ingestRender(db: Db, input: { generationId: string; bytes: number; checksum: string; probe: (i: { storagePath: string; mimeType: string }) => Promise<Record<string, unknown>> }) {
  const [gen] = await db.select().from(generations).where(eq(generations.id, input.generationId)).limit(1);
  if (!gen) throw new Error(`generation ${input.generationId} not found`);
  // A retried download returns the already-linked asset instead of
  // duplicating it and swapping the output.
  if (gen.outputAssetId) {
    const [existing] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, gen.outputAssetId)).limit(1);
    if (existing) return existing;
  }
  if (gen.status !== "in_progress" && gen.status !== "completed") {
    throw new Error(`generation ${input.generationId} has status ${gen.status} — it accepts no render`);
  }
  const [project] = await db.select({ workspaceId: projects.workspaceId }).from(projects).where(eq(projects.id, gen.projectId)).limit(1);
  const storagePath = `renders/${gen.projectId}/${gen.id}.mp4`;
  const meta = await input.probe({ storagePath, mimeType: "video/mp4" });
  const [render] = await db
    .insert(mediaAssets)
    .values({ workspaceId: project!.workspaceId, kind: "render", storagePath, mimeType: "video/mp4", bytes: input.bytes, checksum: input.checksum, meta })
    .returning();
  await db.update(generations).set({ outputAssetId: render!.id }).where(eq(generations.id, gen.id));
  return render!;
}

// The project timeline: every launch with its status and provider, newest
// first, with the saved video's real length once there is one (a model may
// make it longer or shorter than the clip length asked for).
export async function listGenerationsForProject(db: Db, projectId: string) {
  const rows = await db
    .select({ generation: generations, meta: mediaAssets.meta })
    .from(generations)
    .leftJoin(mediaAssets, eq(mediaAssets.id, generations.outputAssetId))
    .where(eq(generations.projectId, projectId))
    .orderBy(desc(generations.createdAt));
  return rows.map(({ generation, meta }) => {
    const probed = Number(meta?.durationS);
    return { ...generation, mediaDurationS: Number.isFinite(probed) && probed > 0 ? probed : null };
  });
}
