import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { actorAssets, actors, attachActorToProject, listActors } from "~/modules/actors";
import type { MediaModel } from "~/modules/models";
import { projects } from "~/modules/studio";
import type { Db } from "~/server/db/types";
import { createTestDb, type TestDb } from "~/test/db";
import { seedFixture, type Fixture } from "~/test/fixture";
import {
  ActorCreateError,
  ActorInUseError,
  createActor,
  deleteCustomActor,
  drawsFromReference,
  frontPrompt,
  type DrawImages,
} from "./actor-create";

let t: TestDb;
let db: Db;
let fx: Fixture;
let dataDir: string;

beforeAll(async () => {
  t = await createTestDb();
  db = t.db as unknown as Db;
  fx = await seedFixture(db, { userId: "84444444-4444-4444-8444-444444444444", name: "Made actors" });
  dataDir = await mkdtemp(join(tmpdir(), "troupe-actor-create-"));
  vi.stubEnv("TROUPE_DATA_DIR", dataDir);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(dataDir, { recursive: true, force: true });
});

// A 4×3 PNG header: enough for the sniffing and the size.
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 4, 0, 0, 0, 3, 8, 6, 0,
  0, 0,
]);

const model: MediaModel = {
  key: "photo-openrouter-black-forest-labs-flux-3-image-klein",
  medium: "image",
  label: "FLUX.3 Klein",
  vendor: "Black Forest Labs",
  provider: "openrouter",
  credential: "openrouter",
  modelId: "black-forest-labs/flux-3-image-klein",
  aspectRatios: ["3:4"],
  sizes: null,
  voices: null,
  languages: null,
  instructions: false,
  price: { usd: 0.01, per: "image" },
  archived: false,
  status: "ready",
  statusDetail: null,
};

const description = {
  name: "Maya",
  gender: "female" as const,
  ageRange: "25-34",
  style: "casual",
  look: "Dark curly hair in a loose bun, light freckles, cream knit sweater.",
  voiceProfile: "warm and enthusiastic",
};

type Call = Parameters<DrawImages>;

function fakeDraw(answer: (call: Call) => Awaited<ReturnType<DrawImages>> | Promise<never>) {
  const calls: Call[] = [];
  const draw = (async (...call: Call) => {
    calls.push(call);
    return answer(call);
  }) as DrawImages;
  return { draw, calls };
}

describe("making an actor", () => {
  it("draws the front from the description, then the five others from the front, and keeps them", async () => {
    const fake = fakeDraw(() => ({ images: [{ data: PNG, mediaType: "image/png" }], warnings: [], costUsd: 0.009 }));
    const made = await createActor(
      db,
      { workspaceId: fx.workspaceId, description, model, apiKey: "or-key" },
      fake.draw,
    );

    expect(fake.calls).toHaveLength(6);
    const [settings, front] = fake.calls[0]!;
    expect(settings).toEqual({ provider: "openrouter", apiKey: "or-key", model: model.modelId });
    expect(front.prompt).toBe(frontPrompt(description));
    expect(front.prompt).toMatch(/fictional woman \(not a real or famous person\), aged 25-34/);
    expect(front.providerOptions).toBeUndefined();
    for (const [, variant] of fake.calls.slice(1)) {
      expect(variant.prompt).toMatch(/^The same person as in the reference photo/);
      const refs = (variant.providerOptions!.openrouter as { input_references: { image_url: { url: string } }[] })
        .input_references;
      expect(refs[0]!.image_url.url).toMatch(/^data:image\/png;base64,/);
    }

    expect(made.costUsd).toBe(0.054);
    expect(made.actor).toMatchObject({ name: "Maya", status: "active", portraitCount: 6, workspaceId: fx.workspaceId });
    expect(made.actor.portraitPath).toBe(`custom-actors/${made.actor.id}/v1/front.png`);
    const files = await readdir(join(dataDir, "custom-actors", made.actor.id, "v1"));
    expect(files.sort()).toEqual(
      ["calm.png", "excited.png", "front.png", "happy.png", "profile-left.png", "profile-right.png"].sort(),
    );

    // Listed in its workspace only, and castable there.
    expect((await listActors(db, {})).some((a) => a.id === made.actor.id)).toBe(false);
    const [project] = await db
      .insert(projects)
      .values({ workspaceId: fx.workspaceId, title: "With Maya", format: "9:16", platform: "tiktok", language: "en" })
      .returning();
    await attachActorToProject(db, { projectId: project!.id, actorId: made.actor.id });

    // A project casts her: she stays until it casts someone else.
    await expect(deleteCustomActor(db, fx.workspaceId, made.actor.id)).rejects.toBeInstanceOf(ActorInUseError);
    await db.update(projects).set({ actorId: null }).where(eq(projects.id, project!.id));
    expect(await deleteCustomActor(db, fx.workspaceId, made.actor.id)).toBe(true);
    expect(await db.select().from(actors).where(eq(actors.id, made.actor.id))).toEqual([]);
    expect(await db.select().from(actorAssets).where(eq(actorAssets.actorId, made.actor.id))).toEqual([]);
    await expect(readdir(join(dataDir, "custom-actors", made.actor.id, "v1"))).resolves.toEqual([]);
  });

  it("keeps nothing when a picture fails, and says why without the key", async () => {
    let n = 0;
    const fake = fakeDraw(() => {
      n += 1;
      if (n === 3) return Promise.reject(Object.assign(new Error("Insufficient credits"), { code: "payment" }));
      return { images: [{ data: PNG, mediaType: "image/png" }], warnings: [] };
    });
    const before = (await db.select().from(actors)).length;
    await expect(
      createActor(db, { workspaceId: fx.workspaceId, description, model, apiKey: "or-key" }, fake.draw),
    ).rejects.toThrow(/could not draw the actor: Insufficient credits/);
    expect((await db.select().from(actors)).length).toBe(before);
  });

  it("refuses, before any call, a photo model that cannot draw from a reference", async () => {
    const fake = fakeDraw(() => ({ images: [], warnings: [] }));
    const openai = { ...model, provider: "openai" as const, credential: "openai" as const, label: "GPT Image 2" };
    expect(drawsFromReference(openai)).toBe(false);
    await expect(
      createActor(db, { workspaceId: fx.workspaceId, description, model: openai, apiKey: "k" }, fake.draw),
    ).rejects.toBeInstanceOf(ActorCreateError);
    expect(fake.calls).toEqual([]);
  });

  it("refuses a picture that is not one", async () => {
    const fake = fakeDraw(() => ({
      images: [{ data: Uint8Array.from([1, 2, 3]), mediaType: "image/png" }],
      warnings: [],
    }));
    await expect(
      createActor(db, { workspaceId: fx.workspaceId, description, model, apiKey: "k" }, fake.draw),
    ).rejects.toThrow(/no readable picture/);
  });

  it("never deletes a library actor", async () => {
    const lib = (await listActors(db, {}))[0]!;
    expect(await deleteCustomActor(db, fx.workspaceId, lib.id)).toBe(false);
  });
});
