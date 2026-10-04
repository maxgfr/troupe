import "fake-indexeddb/auto";

import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createBrowserAdapter, generations, launchGeneration, reconcileDueJobs, type BrowserRenderer } from "~/modules/generation";
import type { Db } from "~/server/db/types";
import { createTestDb, type TestDb } from "~/test/db";
import { seedFixture, type Fixture } from "~/test/fixture";
import { installFakeLocks } from "./fake-locks";
import { ingestBrowserRender, settledBrowserJobs } from "./ingest";
import { clearJobs, jobState, pruneJobs, readJob, saveJob } from "./jobs";

// The demo's ingest against a real (PGlite) studio database: the render is
// stored from what the page already read, and its job, MP4 included, stays
// until the transaction that recorded the render has committed.

let t: TestDb;
let fx: Fixture;

const renderer: BrowserRenderer = {
  async start(job) {
    const id = crypto.randomUUID();
    await saveJob({ id, status: "succeeded", job, video: new Blob(["mp4-bytes"], { type: "video/mp4" }), probe: { durationS: 5, width: 720, height: 1280 }, checksum: "abc123", createdAt: Date.now() });
    return id;
  },
  state: async (id) => jobState(id),
  result: async () => {
    throw new Error("the ingest reads the job record, not the result");
  },
  check: async () => ({ ok: true, message: "ok" }),
};
const adapter = createBrowserAdapter({ renderer });

beforeAll(async () => {
  t = await createTestDb();
  fx = await seedFixture(t.db, { userId: "a7333333-3333-4333-8333-333333333333", name: "Browser ingest" });
});

beforeEach(async () => {
  installFakeLocks();
  await clearJobs();
});

async function launch() {
  const gen = await launchGeneration(t.db, { projectId: fx.projectId, scriptId: fx.scriptId, adapter, tier: "draft", durationS: 6, resolution: "720p" });
  return gen;
}

const reconcile = (db: Db, now = new Date(Date.now() + 5_000)) => reconcileDueJobs(db, { adapters: [adapter], ingest: ingestBrowserRender, now });

describe("browser render ingest", () => {
  it("stores the render from the page's checks and keeps the job until the studio has settled it", async () => {
    const gen = await launch();
    expect(await reconcile(t.db)).toContainEqual({ generationId: gen.id, outcome: "completed" });

    const [row] = await t.db.select().from(generations).where(eq(generations.id, gen.id));
    expect(row?.status).toBe("completed");
    expect(row?.outputAssetId).toBeTruthy();
    // Still there: the ingest ran inside the reconcile transaction.
    expect(await readJob(gen.providerJobId!)).toBeDefined();

    expect(await settledBrowserJobs(t.db, [gen.providerJobId!, "unknown"])).toEqual(new Map([[gen.providerJobId!, "settled"]]));
    await pruneJobs((ids) => settledBrowserJobs(t.db, ids));
    expect(await readJob(gen.providerJobId!)).toBeUndefined();
  });

  it("loses nothing when the transaction recording the render rolls back", async () => {
    const gen = await launch();
    await t.db
      .transaction(async (tx) => {
        await reconcile(tx as unknown as Db);
        throw new Error("commit failed");
      })
      .catch(() => {});
    const [row] = await t.db.select().from(generations).where(eq(generations.id, gen.id));
    expect(row?.status).toBe("in_progress");
    expect(await settledBrowserJobs(t.db, [gen.providerJobId!])).toEqual(new Map([[gen.providerJobId!, "pending"]]));
    await pruneJobs((ids) => settledBrowserJobs(t.db, ids));
    expect((await readJob(gen.providerJobId!))?.video).toBeDefined();

    // The next poll stores it.
    expect(await reconcile(t.db, new Date(Date.now() + 10_000))).toContainEqual({ generationId: gen.id, outcome: "completed" });
  });
});
