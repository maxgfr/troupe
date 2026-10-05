import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "~/test/db";
import { testCaller } from "~/test/caller";
import { seedFixture } from "~/test/fixture";
import { TEST_CAPS } from "~/test/adapters";
import { generations, generationWatches, mediaAssets, launchGeneration, reconcileDueJobs, type VideoProviderAdapter } from "~/modules/generation";
vi.mock("./supabase", () => ({ uploadToSupabase: vi.fn(async () => false) }));
import { ffprobePath, persistProviderRender } from "./storage";
import { serveMediaFile } from "./serve";
let t: TestDb, folder: string;
beforeAll(async () => { t = await createTestDb(); folder = await mkdtemp(join(tmpdir(), "troupe-test-")); vi.stubEnv("TROUPE_DATA_DIR", folder); vi.stubEnv("VERCEL", ""); });
afterAll(async () => { vi.unstubAllEnvs(); await t.pg.close(); await rm(folder, { recursive: true, force: true }); });
it("retries a failed download without resubmitting, validates a real MP4, persists it and serves byte ranges", async () => {
  const fixture = await seedFixture(t.db, { userId: "55555555-5555-4555-8555-555555555555", name: "Media test" });
  const bytes = await readFile("src/test/fixtures/clip.mp4");
  const createJob = vi.fn(async () => ({ providerJobId: "operations/media-test" }));
  const download = vi.fn().mockRejectedValueOnce(new Error("Temporary failure")).mockResolvedValue(bytes);
  const adapter: VideoProviderAdapter = {
    modelKey: "veo-test", family: "veo", modelId: "test", createJob,
    capabilities: () => ({ ...TEST_CAPS, aspectRatios: ["9:16"] }),
    getJob: async () => ({ kind: "completed", providerJobId: "operations/media-test", eventType: "operation.completed", outputUrl: "https://provider.example/clip.mp4" }),
    downloadResult: download,
  };
  const gen = await launchGeneration(t.db, { projectId: fixture.projectId, scriptId: fixture.scriptId, adapter, durationS: 8, resolution: "720p", tier: "draft" });
  const due = async () => t.db.update(generationWatches).set({ nextPollAt: new Date(0) }).where(eq(generationWatches.generationId, gen.id));
  await due();
  expect((await reconcileDueJobs(t.db, { adapters: [adapter], ingest: persistProviderRender }))[0]!.outcome).toBe("pending");
  const [retry] = await t.db.select().from(generations).where(eq(generations.id, gen.id));
  expect(retry!.errorCode).toBe("DOWNLOAD_RETRY"); expect(retry!.outputAssetId).toBeNull();
  await due();
  expect((await reconcileDueJobs(t.db, { adapters: [adapter], ingest: persistProviderRender }))[0]!.outcome).toBe("completed");
  const [done] = await t.db.select().from(generations).where(eq(generations.id, gen.id));
  const [asset] = await t.db.select().from(mediaAssets).where(eq(mediaAssets.id, done!.outputAssetId!));
  expect(asset!.meta).toMatchObject({ durationS: 1, width: 160, height: 90, storage: "local" });
  expect(createJob).toHaveBeenCalledTimes(1); expect(download).toHaveBeenCalledTimes(2);
  const caller = testCaller({ db: t.db, userId: "55555555-5555-4555-8555-555555555555" });
  const exported = await caller.export.create({ projectId: fixture.projectId, generationId: gen.id, platform: "tiktok", caption: "A test clip", hashtags: [], qualityConfirmed: true });
  expect(exported.qualityConfirmedBy).toBe("55555555-5555-4555-8555-555555555555");
  expect(exported.downloadUrl).toBe(`/api/media/${asset!.id}?download=1`);
  const partial = await serveMediaFile(asset!.storagePath, "bytes=0-15", null);
  expect(partial.status).toBe(206);
  expect(Buffer.from(await partial.arrayBuffer())).toEqual(bytes.subarray(0, 16));
  expect((await serveMediaFile(asset!.storagePath, "bytes=9999999-", null)).status).toBe(416);
  const full = await serveMediaFile(asset!.storagePath, null, "spring-drop-2026-10-05.mp4");
  expect(full.headers.get("content-disposition")).toBe('attachment; filename="spring-drop-2026-10-05.mp4"');
  expect(Buffer.from(await full.arrayBuffer())).toEqual(bytes);
  await expect(serveMediaFile("../outside.mp4", null, null)).rejects.toThrow("Invalid media path");
});

it("checks each downloaded video with the ffprobe FFPROBE_PATH names", async () => {
  const fixture = await seedFixture(t.db, { userId: "66666666-6666-4666-8666-666666666666", name: "ffprobe path" });
  const bytes = await readFile("src/test/fixtures/clip.mp4");
  const adapter: VideoProviderAdapter = {
    modelKey: "veo-ffprobe", family: "veo", modelId: "test", capabilities: () => ({ ...TEST_CAPS, aspectRatios: ["9:16"] }),
    createJob: async () => ({ providerJobId: "operations/ffprobe-path" }),
    downloadResult: async () => bytes,
  };
  const launched = await launchGeneration(t.db, { projectId: fixture.projectId, scriptId: fixture.scriptId, adapter, durationS: 8, resolution: "720p", tier: "draft" });
  const [gen] = await t.db.select().from(generations).where(eq(generations.id, launched.id));
  const done = { kind: "completed" as const, providerJobId: "operations/ffprobe-path", eventType: "operation.completed", outputUrl: "https://provider.example/clip.mp4" };
  vi.stubEnv("FFPROBE_PATH", join(folder, "no-such-ffprobe"));
  await expect(persistProviderRender(t.db, gen!, done, adapter)).rejects.toThrow(/ENOENT/);
  vi.stubEnv("FFPROBE_PATH", "");
  await persistProviderRender(t.db, gen!, done, adapter);
  const [saved] = await t.db.select().from(generations).where(eq(generations.id, launched.id));
  expect(saved!.outputAssetId).not.toBeNull();
});

it("checks videos with FFPROBE_PATH, else the build bundled for Vercel, else the PATH's", () => {
  expect(ffprobePath({ FFPROBE_PATH: "/opt/ffmpeg/bin/ffprobe", VERCEL: "1" })).toBe("/opt/ffmpeg/bin/ffprobe");
  expect(ffprobePath({ VERCEL: "1" })).toBe(join(process.cwd(), "node_modules/@ffprobe-installer/linux-x64/ffprobe"));
  expect(ffprobePath({})).toBe("ffprobe");
});
