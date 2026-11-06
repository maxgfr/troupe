import { and, desc, eq, inArray, isNotNull, lt } from "drizzle-orm";

import type { Db } from "~/server/db/types";
import type { StoredFile } from "~/server/media/store";
import { generations, mediaAssets } from "~/modules/generation";
import { projects } from "~/modules/studio";

// The Shots page keeps its renders in one hidden project per workspace, so
// they share the project renders' storage, polling and access rules. It is
// made on first use and never listed with the projects.
export async function ensureShotsProject(db: Db, workspaceId: string): Promise<string> {
  const find = async () =>
    (
      await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.workspaceId, workspaceId), eq(projects.kind, "shots")))
        .limit(1)
    )[0]?.id;
  const existing = await find();
  if (existing) return existing;
  // Two first launches at once: the partial unique index lets one through.
  const [made] = await db
    .insert(projects)
    .values({
      workspaceId,
      kind: "shots",
      title: "Shots",
      platform: "tiktok",
      format: "9:16",
      language: "en",
      status: "generating",
    })
    .onConflictDoNothing()
    .returning({ id: projects.id });
  const id = made?.id ?? (await find());
  if (!id) throw new Error("The Shots project could not be created.");
  return id;
}

export const SHOTS_PAGE_SIZE = 40;

// The workspace's shots, newest first. `before` is the createdAt of the last
// shot of the previous page.
export async function listShots(
  db: Db,
  projectId: string,
  opts: { favorites?: boolean; before?: Date; limit?: number } = {},
) {
  const rows = await db
    .select({ generation: generations, meta: mediaAssets.meta, mimeType: mediaAssets.mimeType })
    .from(generations)
    .leftJoin(mediaAssets, eq(mediaAssets.id, generations.outputAssetId))
    .where(
      and(
        eq(generations.projectId, projectId),
        opts.favorites ? isNotNull(generations.favoritedAt) : undefined,
        opts.before ? lt(generations.createdAt, opts.before) : undefined,
      ),
    )
    .orderBy(desc(generations.createdAt))
    .limit(opts.limit ?? SHOTS_PAGE_SIZE);
  return rows.map(({ generation, meta, mimeType }) => ({
    ...generation,
    mimeType,
    width: typeof meta?.width === "number" ? meta.width : null,
    height: typeof meta?.height === "number" ? meta.height : null,
    videoDurationS: typeof meta?.durationS === "number" ? meta.durationS : null,
  }));
}

export class ShotBusyError extends Error {}

// Delete finished or failed shots with their video files. A shot still
// rendering is refused: its model would still bill for it. Returns the
// stored files for the caller to delete once the transaction has committed.
export async function deleteShots(
  db: Db,
  projectId: string,
  ids: string[],
): Promise<{ deleted: number; files: StoredFile[] }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: generations.id, status: generations.status, outputAssetId: generations.outputAssetId })
      .from(generations)
      .where(and(eq(generations.projectId, projectId), inArray(generations.id, ids)));
    if (rows.some((r) => r.status === "queued" || r.status === "in_progress"))
      throw new ShotBusyError("A shot is still rendering. Delete it once it has finished.");
    if (rows.length === 0) return { deleted: 0, files: [] };
    const assetIds = rows.map((r) => r.outputAssetId).filter((id): id is string => Boolean(id));
    const assets = assetIds.length ? await tx.select().from(mediaAssets).where(inArray(mediaAssets.id, assetIds)) : [];
    // A relaunch keeps pointing at the shot it retried; drop the link first.
    await tx
      .update(generations)
      .set({ parentGenerationId: null })
      .where(
        inArray(
          generations.parentGenerationId,
          rows.map((r) => r.id),
        ),
      );
    await tx.delete(generations).where(
      inArray(
        generations.id,
        rows.map((r) => r.id),
      ),
    );
    if (assetIds.length) await tx.delete(mediaAssets).where(inArray(mediaAssets.id, assetIds));
    return {
      deleted: rows.length,
      files: assets.map(
        (a): StoredFile => ({
          storagePath: a.storagePath,
          storage: a.meta.storage === "supabase" ? "supabase" : "local",
        }),
      ),
    };
  });
}

export async function favoriteShot(db: Db, projectId: string, generationId: string, on: boolean) {
  const [row] = await db
    .update(generations)
    .set({ favoritedAt: on ? new Date() : null })
    .where(and(eq(generations.projectId, projectId), eq(generations.id, generationId)))
    .returning({ id: generations.id, favoritedAt: generations.favoritedAt });
  return row ?? null;
}
