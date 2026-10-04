import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createTestDb, type TestDb } from "~/test/db";
import { fakeAdapter, finishGeneration, asModels } from "~/test/adapters";
import { createWorkspace } from "~/modules/identity";
import { projects } from "~/modules/studio/server/schema";
import { seedActorLibrary, listActors, attachActorToProject } from "~/modules/actors";
import { pasteScript } from "~/modules/script";
import { generations } from "~/modules/generation";
import { getBenchmarkRun, startBenchmark, voteOnEntry } from "~/modules/benchmark";
import { apiMediaLinks } from "~/server/media/store";

const USER = "91111111-1111-4111-8111-111111111111";

let t: TestDb;
let ws: string;
let projectId: string;
let scriptId: string;

function pair(opts: { klingFails?: boolean } = {}) {
  return [
    fakeAdapter({ modelKey: "veo" }),
    fakeAdapter({ modelKey: "kling", createJob: opts.klingFails ? async () => { throw new Error("HTTP 500"); } : undefined }),
  ];
}

beforeAll(async () => {
  t = await createTestDb();
  ws = (await createWorkspace(t.db, { userId: USER, name: "Bench" })).id;
  await seedActorLibrary(t.db);
  const actor = (await listActors(t.db, {}))[0]!;
  const [p] = await t.db.insert(projects).values({ workspaceId: ws, title: "Bench", format: "9:16", platform: "tiktok", language: "en" }).returning();
  projectId = p!.id;
  await attachActorToProject(t.db, { projectId, actorId: actor.id });
  scriptId = (await pasteScript(t.db, { projectId, text: "Same brief everywhere." })).id;
});

describe("model comparison harness", () => {
  it("one brief fans out one generation per provider with identical inputs", async () => {
    const run = await startBenchmark(t.db, { projectId, scriptId, models: asModels(pair()), durationS: 8, resolution: "720p" });
    expect(run.entries).toHaveLength(2);
    const gens = await Promise.all(run.entries.map(async (e) => (await t.db.select().from(generations).where(eq(generations.id, e.generationId)))[0]!));
    expect(new Set(gens.map((g) => g.prompt)).size).toBe(1);
    expect(new Set(gens.map((g) => g.durationS)).size).toBe(1);
    expect(new Set(gens.map((g) => g.modelKey))).toEqual(new Set(["veo", "kling"]));
  });

  it("votes are 1–5 integers per generation and the run exposes per-provider means, cost and latency", async () => {
    const run = await startBenchmark(t.db, { projectId, scriptId, models: asModels(pair()), durationS: 8, resolution: "720p" });
    const veoEntry = run.entries.find((e) => e.modelKey === "veo")!;
    await finishGeneration(t.db, veoEntry.generationId, { kind: "completed", costUsd: 2.4 });

    await voteOnEntry(t.db, { entryId: veoEntry.id, userId: USER, score: 4 });
    await voteOnEntry(t.db, { entryId: veoEntry.id, userId: "a1111111-1111-4111-8111-111111111111", score: 5 });
    await expect(voteOnEntry(t.db, { entryId: veoEntry.id, userId: USER, score: 7 })).rejects.toThrowError(/1.*5/);

    const view = await getBenchmarkRun(t.db, run.id, apiMediaLinks);
    const veoView = view.entries.find((e) => e.modelKey === "veo")!;
    expect(veoView.status).toBe("completed");
    expect(veoView.costUsd).toBe(2.4);
    expect(veoView.latencyMs).toBeGreaterThanOrEqual(0);
    expect(veoView.meanScore).toBe(4.5);
    expect(view.meanByModel.veo).toBe(4.5);
  });

  it("one provider failing leaves the comparison available for the completed ones", async () => {
    const run = await startBenchmark(t.db, { projectId, scriptId, models: asModels(pair({ klingFails: true })), durationS: 8, resolution: "720p" });
    await finishGeneration(t.db, run.entries.find((e) => e.modelKey === "veo")!.generationId, { kind: "completed" });
    const view = await getBenchmarkRun(t.db, run.id, apiMediaLinks);
    expect(view.entries).toHaveLength(2);
    expect(view.entries.find((e) => e.modelKey === "veo")!.status).toBe("completed");
    expect(view.entries.find((e) => e.modelKey === "kling")!.status).toBe("failed");
  });
});
