import type { VideoModel } from "llm-models/video";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { listModelConfigs, resolveCatalog } from "~/modules/models";
import type { Db } from "~/server/db/types";
import { createTestDb, type TestDb } from "~/test/db";
import {
  addCatalogVideoModel,
  capabilitiesOf,
  catalogModelKey,
  forgetVideoCatalog,
  listCatalogVideoModels,
  toCatalogEntry,
} from "./video-catalog";

let t: TestDb;
let db: Db;
beforeAll(async () => {
  t = await createTestDb();
  db = t.db as unknown as Db;
});
beforeEach(() => forgetVideoCatalog());

const model = (patch: Partial<VideoModel> = {}): VideoModel => ({
  provider: "openrouter",
  id: "kwaivgi/kling-v3.0-pro",
  name: "Kling Video v3.0 Pro",
  owner: "kwaivgi",
  operations: ["text-to-video", "image-to-video"],
  inputs: ["text", "image"],
  durations: [3, 4, 5, 6, 7, 8, 9, 10],
  aspectRatios: ["16:9", "9:16", "1:1"],
  resolutions: ["720p"],
  audio: true,
  seed: null,
  frameImages: ["first_frame"],
  prices: [{ usdPerSecond: 0.112 }, { usdPerSecond: 0.168, audio: true }],
  ...patch,
});

describe("the video catalog", () => {
  it("drives a listed model with the settings it lists, and says why it cannot drive another", () => {
    expect(capabilitiesOf(model())).toEqual({
      ok: true,
      caps: {
        aspectRatios: ["16:9", "9:16", "1:1"],
        resolutions: ["720p"],
        durationsS: [3, 4, 5, 6, 7, 8, 9, 10],
        audio: "optional",
        dialogueLanguages: null,
      },
    });
    expect(capabilitiesOf(model({ audio: null })).ok && capabilitiesOf(model({ audio: null }))).toMatchObject({
      caps: { audio: "none" },
    });
    expect(capabilitiesOf(model({ operations: ["image-to-video"] }))).toEqual({
      ok: false,
      reason: "This model does not render from a text prompt.",
    });
    expect(toCatalogEntry(model({ durations: null }))).toMatchObject({
      unavailable: "Its provider does not list the formats and lengths it renders.",
      pricePerSecondUsd: 0.168,
    });
  });

  it("adds a model on its provider's key, priced with sound, and adding it again refreshes it", async () => {
    const models = [
      model(),
      model({ provider: "xai", id: "grok-imagine-video-1.5", name: "Grok Imagine Video 1.5", owner: "xai" }),
    ];
    const added = await addCatalogVideoModel(db, { provider: "openrouter", id: "kwaivgi/kling-v3.0-pro", models });
    expect(added).toEqual({ modelKey: "openrouter-kwaivgi-kling-v3-0-pro", label: "Kling Video v3.0 Pro" });
    await addCatalogVideoModel(db, { provider: "xai", id: "grok-imagine-video-1.5", models });
    await addCatalogVideoModel(db, { provider: "openrouter", id: "kwaivgi/kling-v3.0-pro", models });

    const rows = await listModelConfigs(db);
    expect(rows.filter((r) => r.family === "catalog")).toHaveLength(2);
    const resolved = resolveCatalog({ rows, credentials: { openrouter: "saved" } });
    expect(resolved.find((m) => m.key === added.modelKey)).toMatchObject({
      family: "catalog",
      kind: "cloud",
      credential: "openrouter",
      vendor: "kwaivgi via OpenRouter",
      modelId: "kwaivgi/kling-v3.0-pro",
      status: "ready",
      pricePerSecondUsd: 0.168,
    });
    expect(resolved.find((m) => m.key === catalogModelKey("xai", "grok-imagine-video-1.5"))).toMatchObject({
      credential: "xai",
      vendor: "xAI",
      status: "missing-credentials",
      statusDetail: "Add an xAI key in Settings.",
    });
  });

  it("refuses a model its provider does not list, and one it cannot drive", async () => {
    await expect(addCatalogVideoModel(db, { provider: "gateway", id: "nope/none", models: [model()] })).rejects.toThrow(
      "gateway lists no video model nope/none.",
    );
    await expect(
      addCatalogVideoModel(db, {
        provider: "openrouter",
        id: "x/upscale",
        models: [model({ id: "x/upscale", aspectRatios: null })],
      }),
    ).rejects.toThrow("does not list the formats");
  });

  it("lists every provider from llm-models, keys only widening the list, and keeps it a while", async () => {
    let reads = 0;
    const fakeFetch = (async (input: string | URL | Request) => {
      reads++;
      const url = String(input);
      if (url.includes("openrouter.ai/api/v1/videos/models"))
        return Response.json({
          data: [
            {
              id: "kwaivgi/kling-v3.0-pro",
              name: "Kling: Video v3.0 Pro",
              supported_durations: [5, 10],
              supported_aspect_ratios: ["16:9"],
              supported_resolutions: ["720p"],
              generate_audio: true,
              pricing_skus: { duration_seconds: "0.112" },
            },
          ],
        });
      return new Response("down", { status: 503 });
    }) as typeof fetch;
    const first = await listCatalogVideoModels({}, { fetch: fakeFetch, now: 1_000 });
    expect(first.map((m) => `${m.provider}:${m.id}`)).toEqual(["openrouter:kwaivgi/kling-v3.0-pro"]);
    const before = reads;
    await listCatalogVideoModels({}, { fetch: fakeFetch, now: 2_000 });
    expect(reads).toBe(before);
  });
});
