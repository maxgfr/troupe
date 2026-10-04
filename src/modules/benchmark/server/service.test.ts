import { beforeAll, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "~/test/db";
import { createWorkspace } from "~/modules/identity";
import { projects } from "~/modules/studio/server/schema";
import { seedActorLibrary, listActors, attachActorToProject } from "~/modules/actors";
import { pasteScript } from "~/modules/script";
import { fakeAdapter, asModels } from "~/test/adapters";
import { generations } from "~/modules/generation";
import { getBenchmarkRun, startBenchmark } from "~/modules/benchmark";
import { apiMediaLinks } from "~/server/media/store";

const USER = "94444444-4444-4444-8444-444444444444";

function adapters(suffix: string) {
  return [
    fakeAdapter({ modelKey: "veo", jobId: `veo-${suffix}` }),
    fakeAdapter({ modelKey: "kling", jobId: `kling-${suffix}` }),
  ];
}

let t: TestDb;
let ws: string;
let projectId: string;
let scriptId: string;

beforeAll(async () => {
  t = await createTestDb();
  ws = (await createWorkspace(t.db, { userId: USER, name: "Batch" })).id;
  await seedActorLibrary(t.db);
  const actor = (await listActors(t.db, {}))[0]!;
  const [p] = await t.db.insert(projects).values({ workspaceId: ws, title: "Batch", format: "9:16", platform: "tiktok", language: "en" }).returning();
  projectId = p!.id;
  await attachActorToProject(t.db, { projectId, actorId: actor.id });
  scriptId = (await pasteScript(t.db, { projectId, text: "Batch me." })).id;
});

// The old loop issued one generations SELECT per entry; the batch issues a
// single inArray, bounded regardless of how many providers ran.
describe("getBenchmarkRun batches the generations fetch", () => {
  it("issues a single generations query regardless of entry count", async () => {
    const run = await startBenchmark(t.db, { projectId, scriptId, models: asModels(adapters("b3")), durationS: 8, resolution: "720p" });
    expect(run.entries.length).toBe(2);

    const original = t.db.select.bind(t.db);
    let genSelects = 0;
    const spy = vi.spyOn(t.db, "select").mockImplementation(((...args: unknown[]) => {
      const builder = (original as (...a: unknown[]) => { from: (table: unknown, ...rest: unknown[]) => unknown })(...args);
      const originalFrom = builder.from.bind(builder);
      builder.from = (table: unknown, ...rest: unknown[]) => {
        if (table === generations) genSelects += 1;
        return originalFrom(table, ...rest);
      };
      return builder;
    }) as never);

    try {
      const view = await getBenchmarkRun(t.db, run.id, apiMediaLinks);
      expect(view.entries.length).toBe(2);
      expect(genSelects).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});
