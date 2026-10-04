import { beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "~/test/db";
import { createWorkspace } from "~/modules/identity";
import { projects } from "~/modules/studio/server/schema";
import { actors } from "~/modules/actors/server/schema";
import { ACTOR_CATALOG, attachActorToProject, getActorSeedAssets, listActors, seedActorLibrary } from "~/modules/actors";

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
      .values({ name: "Ghost", gender: "female", ageRange: "35-44", style: "formal", voiceProfile: "quiet", kind: "custom", workspaceId: ws, assetVersion: 1, status: "active" })
      .returning();
    const listed = await listActors(t.db, {});
    expect(listed.find((a) => a.id === broken!.id)?.status).toBe("unavailable");

    const [p] = await t.db
      .insert(projects)
      .values({ workspaceId: ws, title: "Attach test", format: "9:16", platform: "tiktok", language: "fr" })
      .returning();
    await expect(attachActorToProject(t.db, { projectId: p!.id, actorId: broken!.id })).rejects.toThrowError(/unavailable/i);
  });

  it("the checked-in catalog is the 30-actor source of truth and seeding is idempotent", async () => {
    expect(ACTOR_CATALOG).toHaveLength(30);
    await seedActorLibrary(t.db);
    const library = await listActors(t.db, {});
    expect(library.filter((a) => a.workspaceId === null)).toHaveLength(30);
  });
});
