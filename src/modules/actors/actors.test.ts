import { existsSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import * as schema from "~/server/db/schema";
import type { Db } from "~/server/db/types";
import { createTestDb, type TestDb } from "~/test/db";
import { createWorkspace } from "~/modules/identity";
import { projects } from "~/modules/studio/server/schema";
import { actorAssets, actors } from "~/modules/actors/server/schema";
import {
  ACTOR_CATALOG,
  ASSET_SET,
  attachActorToProject,
  getActorSeedAssets,
  listActors,
  seedActorLibrary,
  storagePathFor,
} from "~/modules/actors";

const USER = "61111111-1111-4111-8111-111111111111";

let t: TestDb;
let ws: string;

beforeAll(async () => {
  t = await createTestDb();
  ws = (await createWorkspace(t.db, { userId: USER, name: "Actors" })).id;
  await seedActorLibrary(t.db);
});

describe("AI actor library of 30 consistent synthetic actors", () => {
  it("the seeded library holds exactly 30 active global actors with ≥6 portrait assets incl. ≥3 emotions", async () => {
    const library = await listActors(t.db, {});
    const globalActive = library.filter((a) => a.workspaceId === null && a.status === "active");
    expect(globalActive).toHaveLength(30);
    for (const actor of globalActive.slice(0, 5)) {
      const seed = await getActorSeedAssets(t.db, actor.id);
      expect(seed.assets.length).toBeGreaterThanOrEqual(6);
      const emotions = new Set(seed.assets.filter((a) => a.kind === "emotion").map((a) => a.emotion));
      expect(emotions.size).toBeGreaterThanOrEqual(3);
      for (const asset of seed.assets) expect(asset.storagePath).toMatch(/^actors\//);
    }
  });

  it("filtering by gender, age range and style returns only matching actors", async () => {
    const filtered = await listActors(t.db, { gender: "female", ageRange: "25-34", style: "casual" });
    expect(filtered.length).toBeGreaterThan(0);
    for (const a of filtered) {
      expect(a.gender).toBe("female");
      expect(a.ageRange).toBe("25-34");
      expect(a.style).toBe("casual");
      expect(a.portraitCount).toBeGreaterThanOrEqual(6);
    }
  });

  it("two projects using the same actor get the same versioned portrait seed set", async () => {
    const males = await listActors(t.db, { gender: "male" });
    const actorId = males[0]!.id;
    const seedA = await getActorSeedAssets(t.db, actorId);
    const seedB = await getActorSeedAssets(t.db, actorId);
    expect(seedA.assetVersion).toBe(seedB.assetVersion);
    expect(seedA.assets.map((x) => x.storagePath)).toEqual(seedB.assets.map((x) => x.storagePath));
  });

  it("an actor with missing portrait assets is unavailable and cannot be attached", async () => {
    const [broken] = await t.db
      .insert(actors)
      .values({
        name: "Ghost",
        gender: "female",
        ageRange: "35-44",
        style: "formal",
        voiceProfile: "quiet",
        kind: "custom",
        workspaceId: ws,
        assetVersion: 1,
        status: "active",
      })
      .returning();
    const listed = await listActors(t.db, {});
    expect(listed.find((a) => a.id === broken!.id)?.status).toBe("unavailable");

    const [p] = await t.db
      .insert(projects)
      .values({ workspaceId: ws, title: "Attach test", format: "9:16", platform: "tiktok", language: "fr" })
      .returning();
    await expect(attachActorToProject(t.db, { projectId: p!.id, actorId: broken!.id })).rejects.toThrowError(
      /unavailable/i,
    );
  });

  it("the checked-in catalog is the 30-actor source of truth and seeding is idempotent", async () => {
    expect(ACTOR_CATALOG).toHaveLength(30);
    await seedActorLibrary(t.db);
    const library = await listActors(t.db, {});
    expect(library.filter((a) => a.workspaceId === null)).toHaveLength(30);
  });

  it("lists each actor's front portrait, and none for an actor without pictures", async () => {
    const library = await listActors(t.db, {});
    const lea = ACTOR_CATALOG[0]!;
    expect(library.find((a) => a.name === lea.name && a.ageRange === lea.ageRange)?.portraitPath).toBe(
      storagePathFor(lea.slug, 1, "front.webp"),
    );
    expect(library.find((a) => a.name === "Ghost")?.portraitPath).toBeNull();
  });

  it("keeps the library's pictures in step with the catalog when an older set was seeded", async () => {
    const lea = ACTOR_CATALOG[0]!;
    const [row] = await t.db
      .select({ id: actors.id })
      .from(actors)
      .where(and(eq(actors.name, lea.name), eq(actors.ageRange, lea.ageRange)));
    // Installs seeded before the pictures existed recorded .png paths.
    await t.db.delete(actorAssets).where(eq(actorAssets.actorId, row!.id));
    await t.db.insert(actorAssets).values(
      ASSET_SET.map((a) => ({
        actorId: row!.id,
        kind: a.kind,
        emotion: a.emotion,
        storagePath: storagePathFor(lea.slug, 1, a.file.replace(".webp", ".png")),
        version: 1,
      })),
    );
    await seedActorLibrary(t.db);
    const seed = await getActorSeedAssets(t.db, row!.id);
    expect(seed.assets.map((a) => a.storagePath).sort()).toEqual(
      ASSET_SET.map((a) => storagePathFor(lea.slug, 1, a.file)).sort(),
    );
  });

  // In the browser edition every statement is a round trip to the PGlite
  // worker and a write to IndexedDB, and this runs on every page load and
  // after every reset: a few statements for the whole library, not a few per actor.
  it("seeds the library, and checks it again, in a handful of statements", async () => {
    const fresh = await createTestDb();
    let statements = 0;
    const counted = drizzle(fresh.pg, { schema, logger: { logQuery: () => void statements++ } }) as unknown as Db;
    await seedActorLibrary(counted);
    // Three queries, plus the transaction's begin and commit (not logged):
    // the "at most 5 statements" of docs/AUDIT.md.
    expect(statements).toBeLessThanOrEqual(3);
    expect((await listActors(counted, {})).filter((a) => a.workspaceId === null && a.portraitCount >= 6)).toHaveLength(
      30,
    );
    statements = 0;
    await seedActorLibrary(counted);
    expect(statements).toBeLessThanOrEqual(2);
    await fresh.pg.close();
  });

  it("ships every picture the catalog declares", () => {
    const missing = ACTOR_CATALOG.flatMap((actor) =>
      ASSET_SET.map((a) => storagePathFor(actor.slug, 1, a.file)),
    ).filter((path) => !existsSync(join("public", path)));
    expect(missing).toEqual([]);
  });
});
