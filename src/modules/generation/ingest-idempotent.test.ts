import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

import { createTestDb, type TestDb } from "~/test/db";
import { seedFixture, type Fixture } from "~/test/fixture";
import { fakeAdapter, finishGeneration } from "~/test/adapters";
import { ingestRender, launchGeneration, mediaAssets } from "~/modules/generation";

const USER = "a7222222-2222-4222-8222-222222222222";

let t: TestDb;
let fx: Fixture;

beforeAll(async () => {
  t = await createTestDb();
  fx = await seedFixture(t.db, { userId: USER, name: "Ingest" });
});

async function launchAndFinish(jobId: string, kind: "completed" | "failed") {
  const gen = await launchGeneration(t.db, {
    projectId: fx.projectId,
    scriptId: fx.scriptId,
    adapter: fakeAdapter({ jobId }),
    tier: "final",
    durationS: 8,
    resolution: "720p",
  });
  await finishGeneration(t.db, gen.id, kind === "completed" ? { kind } : { kind, errorCode: "BOOM" });
  return gen;
}

// A re-delivered render must not duplicate assets or
// silently swap the output; a failed generation accepts no render at all.
describe("ingestRender idempotence and status guard", () => {
  it("ingesting the same render twice returns the same asset and stores one row", async () => {
    const gen = await launchAndFinish("ingest-idem-1", "completed");
    const first = await ingestRender(t.db, {
      generationId: gen.id,
      bytes: 10,
      checksum: "c",
      probe: async () => ({ durationS: 8 }),
    });
    const second = await ingestRender(t.db, {
      generationId: gen.id,
      bytes: 10,
      checksum: "c",
      probe: async () => ({ durationS: 8 }),
    });
    expect(second.id).toBe(first.id);
    const renders = await t.db
      .select()
      .from(mediaAssets)
      .where(
        and(eq(mediaAssets.kind, "render"), eq(mediaAssets.storagePath, `renders/${gen.projectId}/${gen.id}.mp4`)),
      );
    expect(renders).toHaveLength(1);
  });

  it("a failed generation refuses a render", async () => {
    const gen = await launchAndFinish("ingest-failed-1", "failed");
    await expect(
      ingestRender(t.db, { generationId: gen.id, bytes: 10, checksum: "c", probe: async () => ({ durationS: 8 }) }),
    ).rejects.toThrow(/failed|status/i);
  });
});
