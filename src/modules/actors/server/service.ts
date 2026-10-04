import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { Db } from "~/server/db/types";
import { projects } from "~/modules/studio/server/schema";
import { ACTOR_CATALOG, ASSET_SET, storagePathFor } from "./catalog";
import { actorAssets, actors } from "./schema";

const MIN_ASSETS = 6;

// Idempotent seed of the 30-actor global library from the catalog.
export async function seedActorLibrary(db: Db): Promise<void> {
  for (const c of ACTOR_CATALOG) {
    const existing = await db
      .select({ id: actors.id })
      .from(actors)
      .where(and(isNull(actors.workspaceId), eq(actors.name, c.name), eq(actors.ageRange, c.ageRange)))
      .limit(1);
    if (existing.length > 0) continue;
    await db.transaction(async (tx) => {
      const [actor] = await tx
        .insert(actors)
        .values({ name: c.name, gender: c.gender, ageRange: c.ageRange, style: c.style, voiceProfile: c.voiceProfile, kind: "library", assetVersion: 1 })
        .returning();
      if (!actor) throw new Error("actor insert returned no row");
      await tx.insert(actorAssets).values(
        ASSET_SET.map((a) => ({ actorId: actor.id, kind: a.kind, emotion: a.emotion, storagePath: storagePathFor(c.slug, 1, a.file), version: 1 })),
      );
    });
  }
}

export interface ListedActor {
  id: string;
  workspaceId: string | null;
  name: string;
  gender: string;
  ageRange: string;
  style: string;
  voiceProfile: string;
  assetVersion: number;
  portraitCount: number;
  // Computed availability — an actor without its portrait set is
  // unavailable regardless of its stored status.
  status: "active" | "unavailable";
}

export async function listActors(db: Db, filter: { gender?: string; ageRange?: string; style?: string }): Promise<ListedActor[]> {
  const conds = [
    filter.gender ? eq(actors.gender, filter.gender as "female") : undefined,
    filter.ageRange ? eq(actors.ageRange, filter.ageRange) : undefined,
    filter.style ? eq(actors.style, filter.style) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);
  const rows = await db
    .select({
      id: actors.id,
      workspaceId: actors.workspaceId,
      name: actors.name,
      gender: actors.gender,
      ageRange: actors.ageRange,
      style: actors.style,
      voiceProfile: actors.voiceProfile,
      assetVersion: actors.assetVersion,
      storedStatus: actors.status,
    })
    .from(actors)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(actors.name));
  const counts = await db
    .select({ actorId: actorAssets.actorId, version: actorAssets.version, n: sql<number>`count(*)::int` })
    .from(actorAssets)
    .groupBy(actorAssets.actorId, actorAssets.version);
  const byKey = new Map(counts.map((c) => [`${c.actorId}|${c.version}`, c.n]));
  return rows.map((r) => {
    const portraitCount = byKey.get(`${r.id}|${r.assetVersion}`) ?? 0;
    return {
      ...r,
      portraitCount,
      status: r.storedStatus === "active" && portraitCount >= MIN_ASSETS ? ("active" as const) : ("unavailable" as const),
    };
  });
}

// The versioned seed set — identical for every caller until the
// portrait set is explicitly re-versioned.
export async function getActorSeedAssets(db: Db, actorId: string) {
  const [actor] = await db.select().from(actors).where(eq(actors.id, actorId)).limit(1);
  if (!actor) throw new Error(`actor ${actorId} not found`);
  const assets = await db
    .select({ kind: actorAssets.kind, emotion: actorAssets.emotion, storagePath: actorAssets.storagePath })
    .from(actorAssets)
    .where(and(eq(actorAssets.actorId, actorId), eq(actorAssets.version, actor.assetVersion)))
    .orderBy(asc(actorAssets.storagePath));
  return { actorId, assetVersion: actor.assetVersion, voiceProfile: actor.voiceProfile, assets };
}

// The actor guard's refusal: a missing or unavailable actor.
export class ActorUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActorUnavailableError";
  }
}

// Unavailable actors cannot be attached to a project.
export async function attachActorToProject(db: Db, input: { projectId: string; actorId: string }): Promise<void> {
  const listed = await listActors(db, {});
  const actor = listed.find((a) => a.id === input.actorId);
  if (!actor) throw new ActorUnavailableError(`actor ${input.actorId} not found`);
  if (actor.status === "unavailable") {
    throw new ActorUnavailableError(`${actor.name} is unavailable: their portraits are missing. Choose another actor.`);
  }
  await db.update(projects).set({ actorId: input.actorId }).where(eq(projects.id, input.projectId));
}

