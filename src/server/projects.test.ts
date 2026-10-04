import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "~/test/db";
import { asModels, fakeAdapter, finishGeneration } from "~/test/adapters";
import { seedFixture } from "~/test/fixture";
import { benchmarkRuns, startBenchmark } from "~/modules/benchmark";
import { generations, ingestRender, launchGeneration, mediaAssets } from "~/modules/generation";
import { projects } from "~/modules/studio";
import { scripts } from "~/modules/script";
import { deleteProjectData } from "./projects";

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
