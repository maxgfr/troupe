import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { Db } from "~/server/db/types";
import { projects } from "~/modules/studio/server/schema";
import { ACTOR_CATALOG, ASSET_SET, storagePathFor } from "./catalog";
import { actorAssets, actors } from "./schema";

const MIN_ASSETS = 6;

const catalogAssets = (actorId: string, slug: string) =>
  ASSET_SET.map((a) => ({ actorId, kind: a.kind, emotion: a.emotion, storagePath: storagePathFor(slug, 1, a.file), version: 1 }));

// Idempotent seed of the 30-actor global library from the catalog. A library
// actor seeded earlier gets its first set's rows rewritten when the catalog's
// files changed (installs seeded before the pictures existed list .png files).
//
// A handful of statements for the whole library, whatever its state: in the
// browser edition each one is a round trip to the PGlite worker and a write
// to IndexedDB, and this runs on every page load and after every reset.
export async function seedActorLibrary(db: Db): Promise<void> {
  const key = (name: string, ageRange: string) => `${name}\u0000${ageRange}`;
  const library = await db.select({ id: actors.id, name: actors.name, ageRange: actors.ageRange }).from(actors).where(isNull(actors.workspaceId)).orderBy(asc(actors.createdAt), asc(actors.id));
  const byKey = new Map<string, string>();
  for (const row of library) if (!byKey.has(key(row.name, row.ageRange))) byKey.set(key(row.name, row.ageRange), row.id);

  const seeded = ACTOR_CATALOG.flatMap((c) => {
    const id = byKey.get(key(c.name, c.ageRange));
    return id ? [{ id, slug: c.slug }] : [];
  });
  const missing = ACTOR_CATALOG.filter((c) => !byKey.has(key(c.name, c.ageRange)));

  // Seeded earlier with other files (installs seeded before the pictures
  // existed list .png files): their first set is rewritten.
  const stored = seeded.length
    ? await db
        .select({ actorId: actorAssets.actorId, storagePath: actorAssets.storagePath })
        .from(actorAssets)
        .where(and(inArray(actorAssets.actorId, seeded.map((s) => s.id)), eq(actorAssets.version, 1)))
    : [];
  const stale = seeded.filter(({ id, slug }) => {
    const have = stored.filter((r) => r.actorId === id).map((r) => r.storagePath);
    const wanted = catalogAssets(id, slug).map((w) => w.storagePath);
    return have.length !== wanted.length || wanted.some((path) => !have.includes(path));
  });
  if (missing.length === 0 && stale.length === 0) return;

  await db.transaction(async (tx) => {
    if (stale.length > 0) {
      await tx.delete(actorAssets).where(and(inArray(actorAssets.actorId, stale.map((s) => s.id)), eq(actorAssets.version, 1)));
    }
    const inserted = missing.length
      ? await tx
          .insert(actors)
          .values(missing.map((c) => ({ name: c.name, gender: c.gender, ageRange: c.ageRange, style: c.style, voiceProfile: c.voiceProfile, kind: "library" as const, assetVersion: 1 })))
          .returning({ id: actors.id, name: actors.name, ageRange: actors.ageRange })
      : [];
    if (inserted.length !== missing.length) throw new Error("actor insert returned too few rows");
    const added = inserted.map((row) => ({ id: row.id, slug: missing.find((c) => c.name === row.name && c.ageRange === row.ageRange)!.slug }));
    await tx.insert(actorAssets).values([...stale, ...added].flatMap(({ id, slug }) => catalogAssets(id, slug)));
  });
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
  // The front portrait of the current set, as a storage path
  // (actors/<slug>/v<n>/front.webp); null without one.
  portraitPath: string | null;
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
  const fronts = await db
    .select({ actorId: actorAssets.actorId, version: actorAssets.version, storagePath: actorAssets.storagePath })
    .from(actorAssets)
    .where(eq(actorAssets.kind, "portrait"));
  const frontByKey = new Map(fronts.map((f) => [`${f.actorId}|${f.version}`, f.storagePath]));
  return rows.map((r) => {
    const portraitCount = byKey.get(`${r.id}|${r.assetVersion}`) ?? 0;
    return {
      ...r,
      portraitCount,
      portraitPath: frontByKey.get(`${r.id}|${r.assetVersion}`) ?? null,
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

