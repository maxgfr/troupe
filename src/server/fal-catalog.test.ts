import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import kling from "~/modules/generation/server/adapters/fal-fixtures/fal-kling-v3-pro.json";
import veo from "~/modules/generation/server/adapters/fal-fixtures/fal-veo31-fast.json";
import { createFalAdapter, parseFalInput, type HttpLike } from "~/modules/generation";
import { listModelConfigs, resolveCatalog } from "~/modules/models";
import { createTestDb, type TestDb } from "~/test/db";
import type { Db } from "~/server/db/types";
import { addFalModel, falModelKey, forgetFalCatalog, labelFromEndpoint, listFalVideoModels } from "./fal-catalog";

let t: TestDb;
let db: Db;
beforeAll(async () => {
  t = await createTestDb();
  db = t.db as unknown as Db;
});
beforeEach(() => forgetFalCatalog());

type Answer = { status?: number; body: unknown };
// A fake fal.ai: answers by URL, and records every request.
function fakeFal(route: (url: URL, init?: Parameters<HttpLike>[1]) => Answer) {
  const calls: { url: string; init?: Parameters<HttpLike>[1] }[] = [];
  const http: HttpLike = async (url, init) => {
    calls.push({ url, init });
    const a = route(new URL(url), init);
    return { ok: (a.status ?? 200) < 400, status: a.status ?? 200, json: async () => a.body };
  };
  return { http, calls };
}

const listed = (endpoint: string, display_name: string, extra: Record<string, unknown> = {}) => ({
  endpoint_id: endpoint,
  metadata: { display_name, status: "active", updated_at: "2026-10-30T00:00:00Z" },
  ...extra,
});

describe("fal.ai's catalog", () => {
  it("reads every page of text-to-video models, skips the inactive ones, and keeps them a while", async () => {
    const fal = fakeFal((url) =>
      url.searchParams.get("cursor") === "p2"
        ? { body: { models: [listed("kling/v4/text-to-video", "Kling 4.0")], has_more: false } }
        : {
            body: {
              models: [
                listed("bytedance/seedance-2.5/text-to-video", "Seedance 2.5"),
                { ...listed("old/model", "Old"), metadata: { status: "deprecated" } },
              ],
              has_more: true,
              next_cursor: "p2",
            },
          },
    );
    const entries = await listFalVideoModels(fal.http, 1_000);
    expect(entries.map((e) => e.endpoint)).toEqual(["bytedance/seedance-2.5/text-to-video", "kling/v4/text-to-video"]);
    expect(entries[0]).toMatchObject({ label: "Seedance 2.5", owner: "bytedance" });
    expect(fal.calls[0]!.url).toContain("category=text-to-video");
    await listFalVideoModels(fal.http, 2_000);
    expect(fal.calls).toHaveLength(2);
  });

  it("adds a model with the settings its schema offers and its per-second price", async () => {
    const endpoint = "fal-ai/kling-video/v3/pro/text-to-video";
    const fal = fakeFal((url) =>
      url.pathname.endsWith("/pricing")
        ? { body: { prices: [{ endpoint_id: endpoint, unit_price: 0.112, unit: "second", currency: "USD" }] } }
        : { body: { models: [listed(endpoint, "Kling Video v3 Pro", { openapi: kling })] } },
    );
    const added = await addFalModel(db, { endpoint, http: fal.http, apiKey: "secret" });
    expect(added).toEqual({ modelKey: falModelKey(endpoint), label: "Kling Video v3 Pro" });
    expect(fal.calls.find((c) => c.url.includes("/pricing"))?.init?.headers).toEqual({ authorization: "Key secret" });

    const models = resolveCatalog({ rows: await listModelConfigs(db), credentials: { google: "none", fal: "saved" } });
    expect(models.find((m) => m.key === added.modelKey)).toMatchObject({
      kind: "cloud",
      credential: "fal",
      family: "fal",
      vendor: "fal-ai via fal.ai",
      modelId: endpoint,
      status: "ready",
      pricePerSecondUsd: 0.112,
      capabilities: { aspectRatios: ["16:9", "9:16", "1:1"], audio: "optional" },
    });
    const keyless = resolveCatalog({ rows: await listModelConfigs(db), credentials: { google: "none", fal: "none" } });
    expect(keyless.find((m) => m.key === added.modelKey)).toMatchObject({
      status: "missing-credentials",
      statusDetail: "Add a fal.ai key in Settings.",
    });
  });

  it("names an endpoint fal.ai gives no name", () => {
    expect(labelFromEndpoint("bytedance/seedance-2.5/text-to-video")).toBe("Seedance 2.5");
    expect(labelFromEndpoint("fal-ai/kling-video/v3/pro/text-to-video")).toBe("Kling Video 3 Pro");
  });

  it("refuses a model Troupe cannot drive, and adds nothing", async () => {
    const fal = fakeFal(() => ({
      body: {
        models: [
          listed("x/image-only", "Image only", {
            openapi: { components: { schemas: { XInput: { properties: { image_url: {} } } } } },
          }),
        ],
      },
    }));
    await expect(addFalModel(db, { endpoint: "x/image-only", http: fal.http, apiKey: null })).rejects.toThrow(
      "This model does not render from a text prompt.",
    );
    await expect(addFalModel(db, { endpoint: "../etc", http: fal.http, apiKey: null })).rejects.toThrow(
      "That is not a fal.ai model id.",
    );
    expect((await listModelConfigs(db)).some((r) => r.id === falModelKey("x/image-only"))).toBe(false);
  });

  it("renders an added model in the endpoint's own request shape", async () => {
    const endpoint = "fal-ai/veo3.1/fast";
    const lookup = fakeFal(() => ({ body: { models: [listed(endpoint, "Veo 3.1 Fast", { openapi: veo })] } }));
    const { modelKey } = await addFalModel(db, { endpoint, http: lookup.http, apiKey: null });
    const row = (await listModelConfigs(db)).find((r) => r.id === modelKey)!;
    const queue = fakeFal(() => ({
      body: {
        request_id: "r1",
        status_url: "https://queue.fal.run/x/requests/r1/status",
        response_url: "https://queue.fal.run/x/requests/r1",
      },
    }));
    const adapter = createFalAdapter({
      model: {
        modelKey,
        endpoint,
        capabilities: row.capabilities!,
        sendsResolution: true,
        input: parseFalInput(row.connection)!,
      },
      http: queue.http,
      apiKey: "secret",
    });
    await adapter.createJob({ prompt: "Dawn.", aspectRatio: "9:16", durationS: 8, resolution: "1080p", audio: true });
    expect(queue.calls[0]!.url).toBe(`https://queue.fal.run/${endpoint}`);
    expect(JSON.parse(queue.calls[0]!.init!.body!)).toEqual({
      prompt: "Dawn.",
      duration: "8s",
      aspect_ratio: "9:16",
      resolution: "1080p",
      generate_audio: true,
    });
  });
});
