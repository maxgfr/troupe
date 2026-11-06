import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { generations, mediaAssets } from "~/modules/generation";
import { resolveMediaModels, type MediaModel } from "~/modules/models";
import type { Db } from "~/server/db/types";
import { createTestDb, type TestDb } from "~/test/db";
import { seedFixture, type Fixture } from "~/test/fixture";
import { ensureShotsProject } from "./shots";
import { imageSize, renderMediaShot, sniffMedia, type MediaRenderer } from "./shot-media";

let t: TestDb;
let db: Db;
let fx: Fixture;
let dataDir: string;

beforeAll(async () => {
  t = await createTestDb();
  db = t.db as unknown as Db;
  fx = await seedFixture(db, { userId: "83333333-3333-4333-8333-333333333333", name: "Photo and voice" });
  dataDir = await mkdtemp(join(tmpdir(), "troupe-shot-media-"));
  vi.stubEnv("TROUPE_DATA_DIR", dataDir);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(dataDir, { recursive: true, force: true });
});

// A 3×2 PNG: signature, IHDR with its width and height.
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 3, 0, 0, 0, 2, 8, 6, 0,
  0, 0,
]);
// An MP3 frame header, then silence.
const MP3 = Uint8Array.from([0xff, 0xfb, 0x90, 0x64, ...new Array(64).fill(0)]);

const model = (patch: Partial<MediaModel>): MediaModel => ({
  key: "photo-openai-gpt-image-2",
  medium: "image",
  label: "GPT Image 2",
  vendor: "OpenAI",
  provider: "openai",
  credential: "openai",
  modelId: "gpt-image-2",
  aspectRatios: ["1:1", "16:9"],
  sizes: null,
  voices: null,
  languages: null,
  instructions: false,
  price: { usd: 0.04, per: "image" },
  archived: false,
  status: "ready",
  statusDetail: null,
  ...patch,
});

function renderers(over: Partial<MediaRenderer> = {}): MediaRenderer & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    image: (async (...args: unknown[]) => {
      calls.push(args);
      return { images: [{ data: PNG, mediaType: "image/png" }], warnings: [], costUsd: 0.042 };
    }) as MediaRenderer["image"],
    speech: (async (...args: unknown[]) => {
      calls.push(args);
      return { audio: { data: MP3, mediaType: "audio/mpeg" }, warnings: [] };
    }) as MediaRenderer["speech"],
    ...over,
  };
}

describe("photo and voice shots", () => {
  it("draws a photo, keeps the file, and records its size and the provider's cost", async () => {
    const projectId = await ensureShotsProject(db, fx.workspaceId);
    const fake = renderers();
    const gen = await renderMediaShot(
      db,
      {
        projectId,
        model: model({}),
        apiKey: "sk-test",
        text: "A mug of coffee on linen.",
        image: { aspectRatio: "16:9" },
        estimatedCostUsd: 0.04,
      },
      fake,
    );
    expect(gen).toMatchObject({ status: "completed", medium: "image", aspectRatio: "16:9", costUsd: "0.042" });
    expect(fake.calls[0]!.slice(0, 2)).toEqual([
      { provider: "openai", apiKey: "sk-test", model: "gpt-image-2" },
      { prompt: "A mug of coffee on linen.", aspectRatio: "16:9", size: undefined, n: 1 },
    ]);
    const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, gen.outputAssetId!));
    expect(asset).toMatchObject({ kind: "render", mimeType: "image/png", bytes: PNG.length });
    expect(asset!.meta).toMatchObject({ width: 3, height: 2, storage: "local" });
    expect(asset!.storagePath).toBe(`renders/${projectId}/${gen.id}.png`);
    expect(await readFile(join(dataDir, asset!.storagePath))).toEqual(Buffer.from(PNG));
  });

  it("says a line with the chosen voice and delivery, and keeps the clip", async () => {
    const projectId = await ensureShotsProject(db, fx.workspaceId);
    const fake = renderers();
    const gen = await renderMediaShot(
      db,
      {
        projectId,
        model: model({
          key: "voice-openai-tts",
          medium: "speech",
          modelId: "gpt-4o-mini-tts",
          instructions: true,
          voices: [{ id: "coral", name: "Coral" }],
        }),
        apiKey: "sk-test",
        text: "Link in my bio!",
        speech: { voice: "coral", instructions: "cheerful" },
        estimatedCostUsd: null,
      },
      fake,
    );
    expect(gen).toMatchObject({
      status: "completed",
      medium: "speech",
      options: { voice: "coral", instructions: "cheerful" },
    });
    expect(fake.calls[0]![1]).toEqual({ text: "Link in my bio!", voice: "coral", instructions: "cheerful" });
    const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, gen.outputAssetId!));
    expect(asset).toMatchObject({ mimeType: "audio/mpeg" });
  });

  it("records a refusal, and a file that is not what was asked, as failed shots", async () => {
    const projectId = await ensureShotsProject(db, fx.workspaceId);
    const refused = await renderMediaShot(
      db,
      { projectId, model: model({}), apiKey: "k", text: "x", image: { aspectRatio: "1:1" }, estimatedCostUsd: null },
      renderers({
        image: (async () => {
          throw Object.assign(new Error("Your request was rejected by the safety system."), {
            code: "invalid-request",
          });
        }) as MediaRenderer["image"],
      }),
    );
    expect(refused).toMatchObject({
      status: "failed",
      errorCode: "PROVIDER_FAILED",
      errorDetail: "Your request was rejected by the safety system.",
    });
    const wrong = await renderMediaShot(
      db,
      { projectId, model: model({}), apiKey: "k", text: "x", image: { aspectRatio: "1:1" }, estimatedCostUsd: null },
      renderers({
        image: (async () => ({
          images: [{ data: new TextEncoder().encode("<html>"), mediaType: "image/png" }],
          warnings: [],
        })) as MediaRenderer["image"],
      }),
    );
    expect(wrong).toMatchObject({ status: "failed", errorCode: "INVALID_FILE", outputAssetId: null });
    const rows = await db.select().from(generations).where(eq(generations.id, wrong.id));
    expect(rows[0]!.completedAt).not.toBeNull();
  });

  it("reads a file's type from its bytes and an image's size from its header", () => {
    expect(sniffMedia(PNG, "image")?.mime).toBe("image/png");
    expect(sniffMedia(PNG, "speech")).toBeNull();
    expect(sniffMedia(MP3, "speech")?.ext).toBe("mp3");
    expect(imageSize(PNG)).toEqual({ width: 3, height: 2 });
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 4, 0, 6, 3, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(imageSize(jpeg)).toEqual({ width: 6, height: 4 });
  });

  it("resolves the studio's photo and voice models with their key's status", () => {
    const now = new Date();
    const row = (id: string, family: string, connection: unknown) => ({
      id,
      family,
      label: id,
      enabled: true,
      archived: false,
      defaults: null,
      pricePerSecondUsd: null,
      timeoutS: null,
      capabilities: null,
      connection,
      secretCiphertext: null,
      secretFingerprint: null,
      createdAt: now,
    });
    const models = resolveMediaModels({
      rows: [
        row("photo-gateway-bfl-flux-2-pro", "image", { provider: "gateway", model: "bfl/flux-2-pro", owner: "bfl" }),
        row("voice-elevenlabs-v3", "speech", { provider: "elevenlabs", model: "eleven_v3" }),
        row("broken", "image", { provider: "nowhere", model: "x" }),
        row("kling", "fal", { endpoint: "fal-ai/kling" }),
      ],
      credentials: { gateway: "saved" },
    });
    expect(models.map((m) => [m.key, m.status])).toEqual([
      ["photo-gateway-bfl-flux-2-pro", "ready"],
      ["voice-elevenlabs-v3", "missing-credentials"],
      ["broken", "invalid"],
    ]);
    expect(models[0]).toMatchObject({
      vendor: "bfl via Vercel AI Gateway",
      aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
    });
    expect(models[1]!.statusDetail).toBe("Add an ElevenLabs key in Settings.");
  });
});
