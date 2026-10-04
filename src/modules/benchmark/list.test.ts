// The Benchmark Lab lists the workspace's runs — no more
// pasting raw run UUIDs. Newest first, with brief, entry count and the
// tie-aware vote winner.
import { beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "~/test/db";
import { createWorkspace } from "~/modules/identity";
import { projects } from "~/modules/studio/server/schema";
import { seedActorLibrary, listActors, attachActorToProject } from "~/modules/actors";
import { pasteScript } from "~/modules/script";
import { fakeAdapter, asModels } from "~/test/adapters";
import { BENCHMARK_LIST_LIMIT, getBenchmarkRun, listBenchmarkRuns, startBenchmark, voteOnEntry } from "~/modules/benchmark";
import { apiMediaLinks } from "~/server/media/store";

const USER = "92222222-2222-4222-8222-222222222222";

let t: TestDb;
let ws: string;
let projectId: string;
let scriptId: string;

function adapters(suffix: string) {
  return [
    fakeAdapter({ modelKey: "veo", jobId: `veo-${suffix}` }),
    fakeAdapter({ modelKey: "kling", jobId: `kling-${suffix}` }),
  ];
}

beforeAll(async () => {
  t = await createTestDb();
  ws = (await createWorkspace(t.db, { userId: USER, name: "List" })).id;
  await seedActorLibrary(t.db);
  const actor = (await listActors(t.db, {}))[0]!;
  const [p] = await t.db.insert(projects).values({ workspaceId: ws, title: "List", format: "9:16", platform: "tiktok", language: "en" }).returning();
  projectId = p!.id;
  await attachActorToProject(t.db, { projectId, actorId: actor.id });
  scriptId = (await pasteScript(t.db, { projectId, text: "List me." })).id;
});

describe("listBenchmarkRuns", () => {
  it("returns the workspace's runs newest first with brief, entry count and vote winner", async () => {
    const first = await startBenchmark(t.db, { projectId, scriptId, models: asModels(adapters("l1")), durationS: 8, resolution: "720p" });
    const second = await startBenchmark(t.db, { projectId, scriptId, models: asModels(adapters("l2")), durationS: 8, resolution: "720p" });
    const veoEntry = second.entries.find((e) => e.modelKey === "veo")!;
    await voteOnEntry(t.db, { entryId: veoEntry.id, userId: USER, score: 4 });

    const runs = await listBenchmarkRuns(t.db, ws);
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs.map((r) => r.id).indexOf(second.id)).toBeLessThan(runs.map((r) => r.id).indexOf(first.id));

    const summary = runs.find((r) => r.id === second.id)!;
    expect(summary.brief).toContain("List me.");
    expect(summary.entryCount).toBe(2);
    expect(summary.winnerModelKey).toBe("veo");
    expect(runs.find((r) => r.id === first.id)!.winnerModelKey).toBeNull();
  });

  it("a vote tie yields no winner in the summary", async () => {
    const run = await startBenchmark(t.db, { projectId, scriptId, models: asModels(adapters("l3")), durationS: 8, resolution: "720p" });
    await voteOnEntry(t.db, { entryId: run.entries[0]!.id, userId: USER, score: 3 });
    await voteOnEntry(t.db, { entryId: run.entries[1]!.id, userId: USER, score: 3 });
    const runs = await listBenchmarkRuns(t.db, ws);
    expect(runs.find((r) => r.id === run.id)!.winnerModelKey).toBeNull();
  });

  it("never leaks another workspace's runs", async () => {
    const other = (await createWorkspace(t.db, { userId: USER, name: "Other" })).id;
    const runs = await listBenchmarkRuns(t.db, other);
    expect(runs).toHaveLength(0);
  });
});

// The list is bounded — limit + createdAt cursor —
// so a benchmark-heavy workspace never ships its whole history to the client.
describe("bounded listBenchmarkRuns", () => {
  it("exposes a sane default page size", () => {
    expect(BENCHMARK_LIST_LIMIT).toBe(50);
  });

  it("honours limit, newest first, and pages older runs via the before cursor", async () => {
    const ws2 = (await createWorkspace(t.db, { userId: USER, name: "Paged" })).id;
    const [p2] = await t.db.insert(projects).values({ workspaceId: ws2, title: "Paged", format: "9:16", platform: "tiktok", language: "en" }).returning();
    const actor = (await listActors(t.db, {}))[0]!;
    await attachActorToProject(t.db, { projectId: p2!.id, actorId: actor.id });
    const s2 = (await pasteScript(t.db, { projectId: p2!.id, text: "List me." })).id;

    const a = await startBenchmark(t.db, { projectId: p2!.id, scriptId: s2, models: asModels(adapters("p1")), durationS: 8, resolution: "720p" });
    const b = await startBenchmark(t.db, { projectId: p2!.id, scriptId: s2, models: asModels(adapters("p2")), durationS: 8, resolution: "720p" });
    const c = await startBenchmark(t.db, { projectId: p2!.id, scriptId: s2, models: asModels(adapters("p3")), durationS: 8, resolution: "720p" });

    const firstPage = await listBenchmarkRuns(t.db, ws2, { limit: 2 });
    expect(firstPage).toHaveLength(2);
    expect(firstPage.map((r) => r.id)).toEqual([c.id, b.id]);

    const older = await listBenchmarkRuns(t.db, ws2, { limit: 2, before: firstPage[1]!.createdAt });
    expect(older.map((r) => r.id)).toEqual([a.id]);
  });
});

// The run view carries the script's own lines so previews can
// cue captions per line instead of one blob.
describe("getBenchmarkRun briefLines", () => {
  it("returns the script lines the run was launched from", async () => {
    const run = await startBenchmark(t.db, { projectId, scriptId, models: asModels(adapters("bl")), durationS: 8, resolution: "720p" });
    const view = await getBenchmarkRun(t.db, run.id, apiMediaLinks);
    expect(view.briefLines).toEqual(["List me."]);
  });
});
