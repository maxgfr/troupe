import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "~/test/db";
import { asModels, fakeAdapter, finishGeneration } from "~/test/adapters";
import { seedFixture } from "~/test/fixture";
import { benchmarkRuns, startBenchmark } from "~/modules/benchmark";
import { generations, ingestRender, launchGeneration, mediaAssets } from "~/modules/generation";
import { projects } from "~/modules/studio";
import { scripts } from "~/modules/script";
import { testCaller } from "~/test/caller";
import { deleteProjectData, listProjects } from "./projects";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t.pg.close(); });

describe("deleting a project", () => {
  it("removes its scripts, renders, comparisons and media rows, and reports the files to delete", async () => {
    const fx = await seedFixture(t.db, { userId: "e2222222-2222-4222-8222-222222222222", name: "Doomed" });
    const keep = await seedFixture(t.db, { userId: "e2222222-2222-4222-8222-222222222222", name: "Kept" });
    const gen = await launchGeneration(t.db, { projectId: fx.projectId, scriptId: fx.scriptId, adapter: fakeAdapter(), tier: "draft", durationS: 8, resolution: "720p" });
    await finishGeneration(t.db, gen.id, { kind: "completed" });
    const render = await ingestRender(t.db, { generationId: gen.id, bytes: 10, checksum: "c", probe: async () => ({ storage: "local" }) });
    const run = await startBenchmark(t.db, { projectId: fx.projectId, scriptId: fx.scriptId, models: asModels([fakeAdapter({ modelKey: "a" }), fakeAdapter({ modelKey: "b" })]), durationS: 8, resolution: "720p" });
    const kept = await launchGeneration(t.db, { projectId: keep.projectId, scriptId: keep.scriptId, adapter: fakeAdapter(), tier: "draft", durationS: 8, resolution: "720p" });

    const removed = await deleteProjectData(t.db, fx.projectId);
    expect(removed.files).toEqual([{ storagePath: render.storagePath, storage: "local" }]);

    expect(await t.db.select().from(projects).where(eq(projects.id, fx.projectId))).toEqual([]);
    expect(await t.db.select().from(scripts).where(eq(scripts.projectId, fx.projectId))).toEqual([]);
    expect(await t.db.select().from(generations).where(eq(generations.projectId, fx.projectId))).toEqual([]);
    expect(await t.db.select().from(mediaAssets).where(eq(mediaAssets.id, render.id))).toEqual([]);
    expect(await t.db.select().from(benchmarkRuns).where(eq(benchmarkRuns.id, run.id))).toEqual([]);
    expect(await t.db.select().from(generations).where(eq(generations.id, kept.id))).toHaveLength(1);
  });
});

describe("project stages on the dashboard", () => {
  it("move from scripting to rendering, to review once a video is ready, and to done once exported", async () => {
    const userId = "e3333333-3333-4333-8333-333333333333";
    const fx = await seedFixture(t.db, { userId, name: "Stages" });
    const stageOf = async () => (await listProjects(t.db, fx.workspaceId)).find((p) => p.id === fx.projectId)!.status;
    expect(await stageOf()).toBe("scripting");

    const first = await launchGeneration(t.db, { projectId: fx.projectId, scriptId: fx.scriptId, adapter: fakeAdapter(), tier: "draft", durationS: 8, resolution: "720p" });
    expect(await stageOf()).toBe("generating");
    await finishGeneration(t.db, first.id, { kind: "failed", errorCode: "X" });
    // A failed render leaves nothing to review.
    expect(await stageOf()).toBe("scripting");

    const second = await launchGeneration(t.db, { projectId: fx.projectId, scriptId: fx.scriptId, adapter: fakeAdapter(), tier: "draft", durationS: 8, resolution: "720p" });
    await finishGeneration(t.db, second.id, { kind: "completed" });
    expect(await stageOf()).toBe("review");

    // Another render on the way shows first: the studio is busy with it.
    const third = await launchGeneration(t.db, { projectId: fx.projectId, scriptId: fx.scriptId, adapter: fakeAdapter(), tier: "draft", durationS: 8, resolution: "720p" });
    expect(await stageOf()).toBe("generating");
    await finishGeneration(t.db, third.id, { kind: "completed" });

    await ingestRender(t.db, { generationId: second.id, bytes: 10, checksum: "c", probe: async () => ({ storage: "local" }) });
    await testCaller({ db: t.db, userId }).export.create({ projectId: fx.projectId, generationId: second.id, platform: "tiktok", caption: "", hashtags: [], qualityConfirmed: true });
    expect(await stageOf()).toBe("done");
    // The exported render is the final one; the others stay drafts.
    const tiers = await t.db.select({ id: generations.id, tier: generations.tier }).from(generations).where(eq(generations.projectId, fx.projectId));
    expect(tiers.filter((g) => g.tier === "final").map((g) => g.id)).toEqual([second.id]);
  });
});

describe("project posters on the dashboard", () => {
  it("name each project's newest saved video, and none before a video is saved", async () => {
    const userId = "e4444444-4444-4444-8444-444444444444";
    const fx = await seedFixture(t.db, { userId, name: "Posters" });
    const posterOf = async () => (await listProjects(t.db, fx.workspaceId)).find((p) => p.id === fx.projectId)!.latestVideoAssetId;
    expect(await posterOf()).toBeNull();

    const older = await launchGeneration(t.db, { projectId: fx.projectId, scriptId: fx.scriptId, adapter: fakeAdapter(), tier: "draft", durationS: 8, resolution: "720p" });
    await finishGeneration(t.db, older.id, { kind: "completed" });
    // Completed, but its video is not saved yet: no poster.
    expect(await posterOf()).toBeNull();
    const olderVideo = await ingestRender(t.db, { generationId: older.id, bytes: 10, checksum: "a", probe: async () => ({ storage: "local" }) });
    expect(await posterOf()).toBe(olderVideo.id);

    const newer = await launchGeneration(t.db, { projectId: fx.projectId, scriptId: fx.scriptId, adapter: fakeAdapter(), tier: "draft", durationS: 8, resolution: "720p" });
    await finishGeneration(t.db, newer.id, { kind: "completed" });
    const newerVideo = await ingestRender(t.db, { generationId: newer.id, bytes: 10, checksum: "b", probe: async () => ({ storage: "local" }) });
    expect(await posterOf()).toBe(newerVideo.id);

    // A render still running does not replace the poster.
    await launchGeneration(t.db, { projectId: fx.projectId, scriptId: fx.scriptId, adapter: fakeAdapter(), tier: "draft", durationS: 8, resolution: "720p" });
    expect(await posterOf()).toBe(newerVideo.id);
  });
});
