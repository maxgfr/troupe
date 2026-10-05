import "fake-indexeddb/auto";

import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createBrowserAdapter, generations, launchGeneration, reconcileDueJobs, type BrowserRenderer } from "~/modules/generation";
import type { Db } from "~/server/db/types";
import { createTestDb, type TestDb } from "~/test/db";
import { seedFixture, type Fixture } from "~/test/fixture";
import { installFakeLocks } from "./fake-locks";
import { clearMediaFiles } from "../media";
import { ingestBrowserRender, keepSettledRenders, settledBrowserJobs } from "./ingest";
import { clearJobs, jobState, readJob, saveJob } from "./jobs";

// The browser edition's ingest against a real (PGlite) studio database:
// inside the reconcile transaction it only records the render, from what the
// page already read; the file is kept in IndexedDB, and the job forgotten,
// once that transaction has committed.

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
  await clearMediaFiles();
});

// What the media service worker would find in IndexedDB.
function mediaFiles(): Promise<{ id: string; storagePath: string; blob: Blob }[]> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("troupe-media", 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const all = open.result.transaction("files").objectStore("files").getAll();
      all.onsuccess = () => {
        resolve(all.result);
        open.result.close();
      };
    };
  });
}

async function launch() {
  const gen = await launchGeneration(t.db, { projectId: fx.projectId, scriptId: fx.scriptId, adapter, tier: "draft", durationS: 6, resolution: "720p" });
  return gen;
}

const reconcile = (db: Db, now = new Date(Date.now() + 5_000)) => reconcileDueJobs(db, { adapters: [adapter], ingest: ingestBrowserRender, now });

describe("browser render ingest", () => {
  it("records the render in the transaction, then keeps its file and forgets the job once it committed", async () => {
    const gen = await launch();
    expect(await reconcile(t.db)).toContainEqual({ generationId: gen.id, outcome: "completed" });

    const [row] = await t.db.select().from(generations).where(eq(generations.id, gen.id));
    expect(row?.status).toBe("completed");
    expect(row?.outputAssetId).toBeTruthy();
    // Nothing was written to IndexedDB inside the transaction.
    expect(await mediaFiles()).toEqual([]);
    expect(await readJob(gen.providerJobId!)).toBeDefined();

    expect(await settledBrowserJobs(t.db, [gen.providerJobId!, "unknown"])).toEqual(
      new Map([[gen.providerJobId!, { state: "settled", file: { assetId: row!.outputAssetId!, storagePath: `renders/${fx.projectId}/${gen.id}.mp4` } }]]),
    );
    await keepSettledRenders(t.db);
    const files = await mediaFiles();
    expect(files.map(({ id, storagePath }) => ({ id, storagePath }))).toEqual([{ id: row!.outputAssetId!, storagePath: `renders/${fx.projectId}/${gen.id}.mp4` }]);
    expect(files[0]!.blob.size).toBe("mp4-bytes".length);
    expect(await readJob(gen.providerJobId!)).toBeUndefined();
  });

  it("leaves no file behind and loses nothing when that transaction rolls back", async () => {
    const gen = await launch();
    await t.db
      .transaction(async (tx) => {
        await reconcile(tx as unknown as Db);
        throw new Error("commit failed");
      })
      .catch(() => {});
    const [row] = await t.db.select().from(generations).where(eq(generations.id, gen.id));
    expect(row?.status).toBe("in_progress");
    expect(await settledBrowserJobs(t.db, [gen.providerJobId!])).toEqual(new Map([[gen.providerJobId!, { state: "pending" }]]));
    await keepSettledRenders(t.db);
    expect(await mediaFiles()).toEqual([]);
    expect((await readJob(gen.providerJobId!))?.video).toBeDefined();

    // The next poll records it, and the file follows.
    expect(await reconcile(t.db, new Date(Date.now() + 10_000))).toContainEqual({ generationId: gen.id, outcome: "completed" });
    await keepSettledRenders(t.db);
    expect(await mediaFiles()).toHaveLength(1);
  });

  it("forgets a failed render's job without keeping any file", async () => {
    const failing: BrowserRenderer = {
      ...renderer,
      async start(job) {
        const id = crypto.randomUUID();
        await saveJob({ id, status: "failed", detail: "The voice model could not load.", job, createdAt: Date.now() });
        return id;
      },
    };
    const gen = await launchGeneration(t.db, { projectId: fx.projectId, scriptId: fx.scriptId, adapter: createBrowserAdapter({ renderer: failing }), tier: "draft", durationS: 6, resolution: "720p" });
    await reconcileDueJobs(t.db, { adapters: [createBrowserAdapter({ renderer: failing })], ingest: ingestBrowserRender, now: new Date(Date.now() + 5_000) });
    await keepSettledRenders(t.db);
    expect(await readJob(gen.providerJobId!)).toBeUndefined();
    expect(await mediaFiles()).toEqual([]);
  });
});
