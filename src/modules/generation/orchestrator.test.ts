import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createTestDb, type TestDb } from "~/test/db";
import { createWorkspace } from "~/modules/identity";
import { projects } from "~/modules/studio/server/schema";
import { seedActorLibrary, listActors, attachActorToProject } from "~/modules/actors";
import { pasteScript } from "~/modules/script";
import { TEST_CAPS, finishGeneration } from "~/test/adapters";
import {
  FIRST_POLL_DELAY_S,
  generations,
  generationWatches,
  launchGeneration,
  reconcileDueJobs,
  type ProviderJobStatus,
  type VideoProviderAdapter,
} from "~/modules/generation";

const USER = "e1111111-1111-4111-8111-111111111111";

// Test double: a provider whose async status endpoint we script.
function testAdapter(jobId: string, getJob?: () => Promise<ProviderJobStatus>): VideoProviderAdapter {
  return {
    modelKey: "veo-test", family: "veo",
    modelId: "veo-3.1",
    capabilities: () => TEST_CAPS,
    createJob: async () => ({ providerJobId: jobId }),
    getJob,
  };
}

let t: TestDb;
let ws: string;
let projectId: string;
let scriptId: string;

async function launchWatched(adapter: VideoProviderAdapter) {
  return launchGeneration(t.db, { projectId, scriptId, adapter, tier: "draft", durationS: 8, resolution: "720p" });
}

async function makeDue(generationId: string, opts: { ageMin?: number } = {}) {
  const past = new Date(Date.now() - 1000);
  const createdAt = opts.ageMin ? new Date(Date.now() - opts.ageMin * 60_000) : undefined;
  await t.db
    .update(generationWatches)
    .set({ nextPollAt: past, ...(createdAt ? { createdAt, deadlineAt: new Date(createdAt.getTime() + 30 * 60_000) } : {}) })
    .where(eq(generationWatches.generationId, generationId));
}

async function watchOf(generationId: string) {
  const [w] = await t.db.select().from(generationWatches).where(eq(generationWatches.generationId, generationId)).limit(1);
  return w;
}

async function genOf(id: string) {
  const [g] = await t.db.select().from(generations).where(eq(generations.id, id)).limit(1);
  return g!;
}

beforeAll(async () => {
  t = await createTestDb();
  ws = (await createWorkspace(t.db, { userId: USER, name: "Orchestrator" })).id;
  await seedActorLibrary(t.db);
  const actorId = (await listActors(t.db, {}))[0]!.id;
  const [p] = await t.db.insert(projects).values({ workspaceId: ws, title: "Orchestrated", format: "9:16", platform: "tiktok", language: "en" }).returning();
  projectId = p!.id;
  await attachActorToProject(t.db, { projectId, actorId });
  scriptId = (await pasteScript(t.db, { projectId, text: "Reconcile me." })).id;
});

describe("job orchestration — Postgres reconciliation queue", () => {
  it("launching a generation arms a watch scheduled on the 20 s polling fallback", async () => {
    const gen = await launchWatched(testAdapter("orch-1"));
    const watch = await watchOf(gen.id);
    expect(watch).toBeDefined();
    expect(watch!.modelKey).toBe("veo-test");
    expect(watch!.providerJobId).toBe("orch-1");
    expect(watch!.attempts).toBe(0);
    const delayS = (watch!.nextPollAt.getTime() - watch!.createdAt.getTime()) / 1000;
    expect(delayS).toBeGreaterThanOrEqual(FIRST_POLL_DELAY_S - 1);
    expect(delayS).toBeLessThanOrEqual(FIRST_POLL_DELAY_S + 1);
  });

  it("a still-pending job backs off instead of hammering the provider", async () => {
    const gen = await launchWatched(testAdapter("orch-2", async () => ({ kind: "pending" })));
    await makeDue(gen.id);
    const results = await reconcileDueJobs(t.db, { adapters: [testAdapter("orch-2", async () => ({ kind: "pending" }))] });
    expect(results.find((r) => r.generationId === gen.id)?.outcome).toBe("pending");
    const watch = await watchOf(gen.id);
    expect(watch!.attempts).toBe(1);
    expect(watch!.nextPollAt.getTime()).toBeGreaterThan(Date.now() + (FIRST_POLL_DELAY_S * 2 - 5) * 1000);
  });

  it("a completed poll finalizes — cost captured, watch disarmed", async () => {
    const gen = await launchWatched(testAdapter("orch-3"));
    await makeDue(gen.id);
    const done: ProviderJobStatus = { providerJobId: "orch-3", kind: "completed", eventType: "operation.completed", costUsd: 1.25 };
    const results = await reconcileDueJobs(t.db, { adapters: [testAdapter("orch-3", async () => done)] });
    expect(results.find((r) => r.generationId === gen.id)?.outcome).toBe("completed");
    const after = await genOf(gen.id);
    expect(after.status).toBe("completed");
    expect(Number(after.costUsd)).toBe(1.25);
    expect(await watchOf(gen.id)).toBeUndefined();
  });

  it("a failed poll records the failure and disarms the watch", async () => {
    const gen = await launchWatched(testAdapter("orch-4"));
    await makeDue(gen.id);
    const failed: ProviderJobStatus = { providerJobId: "orch-4", kind: "failed", eventType: "operation.failed", errorCode: "PROVIDER_MELTDOWN" };
    const results = await reconcileDueJobs(t.db, { adapters: [testAdapter("orch-4", async () => failed)] });
    expect(results.find((r) => r.generationId === gen.id)?.outcome).toBe("failed");
    const after = await genOf(gen.id);
    expect(after.status).toBe("failed");
    expect(after.errorCode).toBe("PROVIDER_MELTDOWN");
    expect(await watchOf(gen.id)).toBeUndefined();
  });

  it("a job non-terminal for more than 30 minutes is force-failed — no zombie in_progress", async () => {
    const gen = await launchWatched(testAdapter("orch-5", async () => ({ kind: "pending" })));
    await makeDue(gen.id, { ageMin: 31 });
    const results = await reconcileDueJobs(t.db, { adapters: [testAdapter("orch-5", async () => ({ kind: "pending" }))] });
    expect(results.find((r) => r.generationId === gen.id)?.outcome).toBe("timeout-failed");
    const after = await genOf(gen.id);
    expect(after.status).toBe("failed");
    expect(after.errorCode).toBe("RECONCILE_TIMEOUT");
    expect(await watchOf(gen.id)).toBeUndefined();
  });

  it("a terminal outcome disarms the watch — reconcile never double-finalizes behind it", async () => {
    const gen = await launchWatched(testAdapter("orch-6"));
    await finishGeneration(t.db, gen.id, { kind: "completed" });
    expect(await watchOf(gen.id)).toBeUndefined();
    // A stale watch on an already-terminal generation is pure cleanup.
    await t.db.insert(generationWatches).values({ generationId: gen.id, modelKey: "veo-test", providerJobId: "orch-6", nextPollAt: new Date(Date.now() - 1000), deadlineAt: new Date(Date.now() + 60_000) });
    const results = await reconcileDueJobs(t.db, { adapters: [testAdapter("orch-6", async () => ({ kind: "pending" }))] });
    expect(results.find((r) => r.generationId === gen.id)?.outcome).toBe("already-terminal");
    expect(await watchOf(gen.id)).toBeUndefined();
    expect((await genOf(gen.id)).status).toBe("completed");
  });

  it("a provider status endpoint that errors is treated as pending — the batch survives flakiness", async () => {
    const gen = await launchWatched(testAdapter("orch-7"));
    await makeDue(gen.id);
    const results = await reconcileDueJobs(t.db, {
      adapters: [testAdapter("orch-7", async () => { throw new Error("boom"); })],
    });
    expect(results.find((r) => r.generationId === gen.id)?.outcome).toBe("pending");
    expect((await watchOf(gen.id))!.attempts).toBe(1);
  });

  it("honours a model's own deadline: a 2-hour local job is not cut at 30 minutes", async () => {
    const adapter = { ...testAdapter("orch-8", async () => ({ kind: "pending" as const })), modelKey: "local-gpu" };
    const gen = await launchGeneration(t.db, { projectId, scriptId, adapter, tier: "draft", durationS: 8, resolution: "720p", timeoutS: 7200 });
    const watch = (await watchOf(gen.id))!;
    expect(watch.deadlineAt.getTime() - watch.createdAt.getTime()).toBeGreaterThanOrEqual(7199_000);
    await makeDue(gen.id);
    const later = new Date(Date.now() + 45 * 60_000);
    expect((await reconcileDueJobs(t.db, { adapters: [adapter], now: later })).find((r) => r.generationId === gen.id)?.outcome).toBe("pending");
    await makeDue(gen.id);
    const past = new Date(Date.now() + 121 * 60_000);
    expect((await reconcileDueJobs(t.db, { adapters: [adapter], now: past })).find((r) => r.generationId === gen.id)?.outcome).toBe("timeout-failed");
  });

  it("drops the cost estimate when the provider reports a failure, keeps it on a timeout", async () => {
    const failing = testAdapter("orch-9", async () => ({ providerJobId: "orch-9", kind: "failed", eventType: "x", errorCode: "PROVIDER_FAILED" }));
    const gen = await launchGeneration(t.db, { projectId, scriptId, adapter: failing, tier: "draft", durationS: 8, resolution: "720p", estimatedCostUsd: 1.2 });
    await makeDue(gen.id);
    await reconcileDueJobs(t.db, { adapters: [failing] });
    expect(await genOf(gen.id)).toMatchObject({ status: "failed", costUsd: null, costSource: null });

    const slow = testAdapter("orch-10", async () => ({ kind: "pending" }));
    const late = await launchGeneration(t.db, { projectId, scriptId, adapter: slow, tier: "draft", durationS: 8, resolution: "720p", estimatedCostUsd: 1.2 });
    await makeDue(late.id, { ageMin: 31 });
    await reconcileDueJobs(t.db, { adapters: [slow] });
    expect(await genOf(late.id)).toMatchObject({ status: "failed", errorCode: "RECONCILE_TIMEOUT", costSource: "estimate" });
  });

  it("never times out a render the provider finished while its download keeps failing", async () => {
    const done = testAdapter("orch-11", async () => ({ providerJobId: "orch-11", kind: "completed", eventType: "x", outputUrl: "https://x/y.mp4" }));
    const gen = await launchWatched(done);
    const ingest = async () => { throw new Error("storage down"); };
    await makeDue(gen.id, { ageMin: 31 });
    const afterDeadline = await reconcileDueJobs(t.db, { adapters: [done], ingest });
    expect(afterDeadline.find((r) => r.generationId === gen.id)?.outcome).toBe("pending");
    expect(await genOf(gen.id)).toMatchObject({ status: "in_progress", errorCode: "DOWNLOAD_RETRY" });
    await makeDue(gen.id);
    const muchLater = new Date(Date.now() + 25 * 60 * 60_000);
    await reconcileDueJobs(t.db, { adapters: [done], ingest, now: muchLater });
    expect(await genOf(gen.id)).toMatchObject({ status: "failed", errorCode: "DOWNLOAD_FAILED" });
  });

  it("routes each poll to its own model even within one family", async () => {
    const polled: string[] = [];
    const comfy = (key: string) => ({ ...testAdapter(`${key}-job`, async () => { polled.push(key); return { kind: "pending" as const }; }), modelKey: key, family: "comfyui" as const });
    const a = comfy("comfy-wan");
    const b = comfy("comfy-ltx");
    const genA = await launchWatched(a);
    const genB = await launchWatched(b);
    await makeDue(genA.id);
    await makeDue(genB.id);
    await reconcileDueJobs(t.db, { adapters: new Map([[a.modelKey, a], [b.modelKey, b]]) });
    expect(polled.sort()).toEqual(["comfy-ltx", "comfy-wan"]);
    expect((await watchOf(genA.id))!.modelKey).toBe("comfy-wan");
  });
});
