import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createTestDb, type TestDb } from "~/test/db";
import { testCaller } from "~/test/caller";
import { seedFixture, type Fixture } from "~/test/fixture";
import { fakeAdapter, finishGeneration } from "~/test/adapters";
import { generations, launchGeneration, mediaAssets } from "~/modules/generation";
import type { MediaStore, StoredFile } from "~/server/media/store";

const MEMBER = "b1111111-1111-4111-8111-111111111111";

let t: TestDb;
let fx: Fixture;

beforeAll(async () => {
  t = await createTestDb();
  fx = await seedFixture(t.db, { userId: MEMBER, name: "Media links" });
});

// A finished render with a stored file, as the ingestor leaves it.
async function renderedGeneration({ workspaceId, projectId, scriptId }: Fixture) {
  const gen = await launchGeneration(t.db, { projectId, scriptId, adapter: fakeAdapter(), tier: "draft", durationS: 8, resolution: "720p" });
  await finishGeneration(t.db, gen.id, { kind: "completed" });
  const [asset] = await t.db.insert(mediaAssets).values({
    workspaceId, kind: "render", storagePath: `renders/${projectId}/${gen.id}.mp4`, mimeType: "video/mp4", bytes: 1, checksum: "x", meta: { storage: "local" },
  }).returning();
  await t.db.update(generations).set({ outputAssetId: asset!.id }).where(eq(generations.id, gen.id));
  return { generationId: gen.id, assetId: asset!.id, storagePath: asset!.storagePath };
}

function fakeMedia() {
  const removed: StoredFile[][] = [];
  const media: MediaStore = {
    urlFor: (assetId, opts) => `blob:media/${assetId}${opts?.download ? "#download" : ""}`,
    remove: async (files) => { removed.push(files); },
  };
  return { media, removed };
}

describe("media links come from the request context", () => {
  it("self-hosted: renders play and download from /api/media", async () => {
    const { generationId, assetId } = await renderedGeneration(fx);
    const caller = testCaller({ db: t.db, userId: MEMBER });
    const timeline = await caller.generation.forProject({ projectId: fx.projectId });
    expect(timeline.find((g) => g.id === generationId)!.outputAssetUrl).toBe(`/api/media/${assetId}`);
    const exported = await caller.export.create({ projectId: fx.projectId, generationId, platform: "tiktok", caption: "c", hashtags: [], qualityConfirmed: true });
    expect(exported.downloadUrl).toBe(`/api/media/${assetId}?download=1`);
  });

  it("timeline, comparison and export links use ctx.media, and deleting a project removes its files through it", async () => {
    const { media, removed } = fakeMedia();
    const caller = testCaller({ db: t.db, userId: MEMBER, media, adapters: [fakeAdapter({ modelKey: "veo" }), fakeAdapter({ modelKey: "kling" })] });
    const own = await seedFixture(t.db, { userId: MEMBER, name: "Disposable media" });
    const { generationId, assetId, storagePath } = await renderedGeneration(own);

    const timeline = await caller.generation.forProject({ projectId: own.projectId });
    expect(timeline.find((g) => g.id === generationId)!.outputAssetUrl).toBe(`blob:media/${assetId}`);
    const exported = await caller.export.create({ projectId: own.projectId, generationId, platform: "tiktok", caption: "c", hashtags: [], qualityConfirmed: true });
    expect(exported.downloadUrl).toBe(`blob:media/${assetId}#download`);

    const run = await caller.benchmark.start({ projectId: own.projectId, scriptId: own.scriptId, modelKeys: ["veo", "kling"], durationS: 8, resolution: "720p" });
    const entry = run!.entries[0]!;
    await t.db.update(generations).set({ outputAssetId: assetId }).where(eq(generations.id, entry.generationId));
    const view = await caller.benchmark.get({ workspaceId: own.workspaceId, runId: run!.id });
    expect(view.entries.find((e) => e.id === entry.id)!.outputAssetUrl).toBe(`blob:media/${assetId}`);

    await caller.studio.deleteProject({ projectId: own.projectId });
    expect(removed).toEqual([[{ storagePath, storage: "local" }]]);
  });
});
