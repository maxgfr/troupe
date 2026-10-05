import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { asModels } from "~/test/adapters";
import { eq, sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "./db";
import { TEST_CAPS } from "./adapters";
import { seedFixture, type Fixture } from "./fixture";
import { createProjectFromWizard, projects } from "~/modules/studio";
import { getScriptHistory, pasteScript } from "~/modules/script";
import { startBenchmark, getBenchmarkRun } from "~/modules/benchmark";
import { generations, generationWatches, launchGeneration, reconcileDueJobs, type VideoProviderAdapter } from "~/modules/generation";
import { apiMediaLinks } from "~/server/media/store";

let t: TestDb;
let fixture: Fixture;
beforeAll(async () => {
  t = await createTestDb();
  fixture = await seedFixture(t.db, { userId: "33333333-3333-4333-8333-333333333333", name: "Release" });
});
afterAll(async () => { await t.pg.close(); });

function adapter(provider: "veo" | "kling"): VideoProviderAdapter {
  return {
    modelKey: provider, family: "http", modelId: "test-model",
    capabilities: () => ({ ...TEST_CAPS, aspectRatios: ["9:16"] }),
    createJob: vi.fn(async () => ({ providerJobId: `${provider}-job` })),
  };
}

it("rolls back the whole wizard when actor attachment fails", async () => {
  const before = await t.db.select().from(projects);
  await expect(createProjectFromWizard(t.db, {
    workspaceId: fixture.workspaceId, title: "Must not survive", platform: "tiktok", format: "9:16", language: "fr", modelKey: "veo",
    actorId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  })).rejects.toThrow();
  expect(await t.db.select().from(projects)).toEqual(before);
  await expect(createProjectFromWizard(t.db, {
    workspaceId: fixture.workspaceId, title: "Complete", platform: "youtube", format: "16:9", language: "fr", modelKey: "veo", actorId: fixture.actorId,
  })).resolves.toMatchObject({ status: "scripting", format: "16:9", language: "fr", modelKey: "veo", actorId: fixture.actorId });
});

it("keeps every concurrent script save as a distinct ordered version", async () => {
  const saved = await Promise.all(["First script", "Second script", "Third script"].map((text) => pasteScript(t.db, { projectId: fixture.projectId, text })));
  expect(new Set(saved.map((s) => s.version)).size).toBe(3);
  const history = await getScriptHistory(t.db, fixture.projectId);
  for (const script of saved) expect(history.find((s) => s.id === script.id)).toMatchObject(script);
});

it("validates every comparison before submitting any paid job", async () => {
  const first = adapter("veo");
  const second = adapter("kling");
  second.capabilities = () => ({ ...first.capabilities(), aspectRatios: ["16:9"] });
  await expect(startBenchmark(t.db, { ...fixture, models: asModels([first, second]), durationS: 8, resolution: "720p" })).rejects.toThrow(/format/);
  expect(first.createJob).not.toHaveBeenCalled();
  expect(second.createJob).not.toHaveBeenCalled();
});

it("submits comparisons concurrently and retains refused renders", async () => {
  const first = adapter("veo");
  const second = adapter("kling");
  let release!: () => void;
  const started = new Promise<void>((resolve) => { release = resolve; });
  first.createJob = vi.fn(async () => { await started; return { providerJobId: "parallel-veo" }; });
  second.createJob = vi.fn(async () => { release(); throw new Error("Provider refused"); });
  const run = await startBenchmark(t.db, { ...fixture, models: asModels([first, second]), durationS: 8, resolution: "720p" });
  const view = await getBenchmarkRun(t.db, run.id, apiMediaLinks);
  expect(view.entries.map((e) => e.status).sort()).toEqual(["failed", "in_progress"]);
  expect(first.createJob).toHaveBeenCalledTimes(1);
  expect(second.createJob).toHaveBeenCalledTimes(1);
});

it("recovers an ingestion SQL failure without resubmitting the video", async () => {
  const provider = adapter("veo");
  provider.getJob = async (providerJobId) => ({ kind: "completed", providerJobId, eventType: "completed" });
  const gen = await launchGeneration(t.db, { ...fixture, adapter: provider, tier: "draft", durationS: 8, resolution: "720p" });
  const due = new Date(Date.now() - 1000);
  await t.db.update(generationWatches).set({ nextPollAt: due }).where(eq(generationWatches.generationId, gen.id));
  const result = await reconcileDueJobs(t.db, { adapters: [provider], ingest: async (db) => { await db.execute(sql`select 1 / 0`); } });
  expect(result.find((r) => r.generationId === gen.id)?.outcome).toBe("pending");
  expect((await t.db.select().from(generations).where(eq(generations.id, gen.id)))[0]?.errorCode).toBe("DOWNLOAD_RETRY");
  await t.db.update(generationWatches).set({ nextPollAt: due }).where(eq(generationWatches.generationId, gen.id));
  await reconcileDueJobs(t.db, { adapters: [provider], ingest: async () => undefined });
  expect((await t.db.select().from(generations).where(eq(generations.id, gen.id)))[0]).toMatchObject({ status: "completed", errorCode: null });
  expect(provider.createJob).toHaveBeenCalledTimes(1);
});

it("retries only persistence when a provider already accepted the job", async () => {
  const provider = adapter("kling");
  // The first transaction records the launch; the one after the provider
  // accepted the job fails once.
  const real = t.db.transaction.bind(t.db);
  const transaction = vi.spyOn(t.db, "transaction").mockImplementationOnce(real).mockRejectedValueOnce(new Error("Transient write failure"));
  try {
    const gen = await launchGeneration(t.db, { ...fixture, adapter: provider, tier: "draft", durationS: 8, resolution: "720p" });
    expect(gen.status).toBe("in_progress");
    expect(provider.createJob).toHaveBeenCalledTimes(1);
    expect((await t.db.select().from(generationWatches).where(eq(generationWatches.generationId, gen.id)))[0]?.providerJobId).toBe("kling-job");
  } finally { transaction.mockRestore(); }
});

it("ends interrupted submissions without automatically charging again", async () => {
  const source = (await t.db.select().from(generations))[0]!;
  const [stale] = await t.db.insert(generations).values({ ...source, id: undefined, providerJobId: null, status: "queued", createdAt: new Date(Date.now() - 31 * 60_000) }).returning();
  const provider = adapter("veo");
  await reconcileDueJobs(t.db, { adapters: [provider] });
  expect((await t.db.select().from(generations).where(eq(generations.id, stale!.id)))[0]).toMatchObject({ status: "failed", errorCode: "SUBMISSION_UNKNOWN" });
  expect(provider.createJob).not.toHaveBeenCalled();
});
