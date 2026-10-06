import { describe, expect, it, vi } from "vitest";

import { BUILTIN_MODELS } from "~/modules/models";
import { fal, google } from "~/test/provider-fixtures";
import { AdapterError, type HttpLike } from "../adapter";
import { createFalAdapter } from "./fal";
import { createVeoTextAdapter } from "./veo-text";

// Every built-in model against the provider responses recorded in
// src/test/provider-fixtures.ts.

const req = { prompt: "A person says hello.", aspectRatio: "9:16", durationS: 4, resolution: "720p", audio: true };
const response = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data });
const veoModels = BUILTIN_MODELS.filter((m) => m.family === "veo");
const falModels = BUILTIN_MODELS.filter((m) => m.family === "fal");

const veo = (key: string, http: HttpLike) => {
  const m = BUILTIN_MODELS.find((b) => b.key === key)!;
  return createVeoTextAdapter({
    model: { modelKey: m.key, modelId: m.modelId, capabilities: m.capabilities },
    http,
    apiKey: "test-key",
  });
};
const falAdapter = (key: string, http: HttpLike) => {
  const m = BUILTIN_MODELS.find((b) => b.key === key)!;
  return createFalAdapter({
    model: {
      modelKey: m.key,
      endpoint: m.modelId,
      capabilities: m.capabilities,
      sendsResolution: m.sendsResolution ?? false,
      promptMaxChars: m.promptMaxChars,
    },
    http,
    apiKey: "test-key",
  });
};
const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AdapterError) return { code: error.code, detail: error.detail };
    throw error;
  }
  throw new Error("expected a refusal");
};

describe.each(veoModels.map((m) => [m.key] as const))("Google %s", (key) => {
  it("submits a long-running job and follows it to the video", async () => {
    const http = vi
      .fn()
      .mockResolvedValueOnce(response(google.operationStarted))
      .mockResolvedValueOnce(response(google.operationRunning))
      .mockResolvedValueOnce(response(google.operationDone));
    const adapter = veo(key, http);
    const { providerJobId } = await adapter.createJob(req);
    const [url, init] = http.mock.calls[0]!;
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${adapter.modelId}:predictLongRunning`);
    expect(init.headers["x-goog-api-key"]).toBe("test-key");
    expect(JSON.parse(init.body)).toEqual({
      instances: [{ prompt: req.prompt }],
      parameters: { aspectRatio: "9:16", durationSeconds: 4, resolution: "720p" },
    });
    expect(await adapter.getJob!(providerJobId)).toEqual({ kind: "pending" });
    expect(await adapter.getJob!(providerJobId)).toMatchObject({
      kind: "completed",
      outputUrl: google.operationDone.response.generateVideoResponse.generatedSamples[0].video.uri,
    });
    expect(http.mock.calls[1]![0]).toBe(
      `https://generativelanguage.googleapis.com/v1beta/${google.operationStarted.name}`,
    );
  });

  it("reports a failed or filtered operation without quoting it", async () => {
    const http = vi
      .fn()
      .mockResolvedValueOnce(response(google.operationFailed))
      .mockResolvedValueOnce(response(google.operationFiltered));
    const adapter = veo(key, http);
    expect(await adapter.getJob!(google.operationStarted.name)).toMatchObject({
      kind: "failed",
      errorCode: "PROVIDER_13",
      detail: "Google reported the render as failed.",
    });
    expect(await adapter.getJob!(google.operationStarted.name)).toMatchObject({
      kind: "failed",
      errorCode: "NO_VIDEO_RETURNED",
      detail: expect.stringMatching(/safety/),
    });
  });

  it.each([
    ["an unknown key", google.invalidKey, 400, "PROVIDER_AUTH", /rejected this API key/],
    ["a missing key", google.noKey, 403, "PROVIDER_AUTH", /^Google received no usable API key/],
    [
      "a key without access",
      google.permission,
      403,
      "PROVIDER_PERMISSION",
      /^Google refused this key access to the Gemini API/,
    ],
    ["an unsupported region", google.region, 400, "PROVIDER_REGION", /region/],
    [
      "a spent quota, or none for Veo on a free key",
      google.quota,
      429,
      "PROVIDER_QUOTA",
      /quota.*Veo needs a paid \(billing-enabled\) project/,
    ],
  ] as const)("refuses a launch with %s, saying what to do", async (_what, body, status, code, said) => {
    const http = vi.fn().mockResolvedValue(response(body, status));
    const refused = await refusal(veo(key, http).createJob(req));
    expect(refused).toEqual({ code, detail: expect.stringMatching(said) });
    // Nothing in a refusal claims the key is valid.
    expect(refused.detail).not.toMatch(/key is valid/);
  });

  it("checks the key for free by reading the model", async () => {
    const http = vi
      .fn()
      .mockResolvedValueOnce(response(google.model))
      .mockResolvedValueOnce(response(google.invalidKey, 400))
      .mockResolvedValueOnce(response({ error: { code: 404, status: "NOT_FOUND" } }, 404));
    const adapter = veo(key, http);
    expect(await adapter.testConnection!()).toMatchObject({
      ok: true,
      message: expect.stringContaining(adapter.modelId),
    });
    expect(await adapter.testConnection!()).toMatchObject({
      ok: false,
      message: expect.stringMatching(/rejected this API key/),
    });
    expect(await adapter.testConnection!()).toMatchObject({
      ok: false,
      message: expect.stringMatching(/does not offer/),
    });
    expect(http.mock.calls.every(([, init]) => init.method === undefined)).toBe(true);
  });
});

describe.each(falModels.map((m) => [m.key] as const))("fal.ai %s", (key) => {
  const endpoint = BUILTIN_MODELS.find((m) => m.key === key)!.modelId;

  it("submits to the queue, follows the returned URLs and reads the video", async () => {
    const http = vi
      .fn()
      .mockResolvedValueOnce(response(fal.submitted(endpoint)))
      .mockResolvedValueOnce(response(fal.inQueue))
      .mockResolvedValueOnce(response(fal.inProgress))
      .mockResolvedValueOnce(response(fal.completed))
      .mockResolvedValueOnce(response(fal.output));
    const adapter = falAdapter(key, http);
    const { providerJobId } = await adapter.createJob({
      ...req,
      durationS: key === "kling-3.0" ? 3 : 4,
      resolution: "720p",
    });
    expect(http.mock.calls[0]![0]).toBe(`https://queue.fal.run/${endpoint}`);
    expect(http.mock.calls[0]![1].headers.authorization).toBe("Key test-key");
    expect(await adapter.getJob!(providerJobId)).toEqual({ kind: "pending" });
    expect(await adapter.getJob!(providerJobId)).toEqual({ kind: "pending" });
    expect(await adapter.getJob!(providerJobId)).toMatchObject({ kind: "completed", outputUrl: fal.output.video.url });
    expect(http.mock.calls[3]![0]).toBe(fal.submitted(endpoint).status_url);
    expect(http.mock.calls[4]![0]).toBe(fal.submitted(endpoint).response_url);
  });

  it.each([
    ["an unknown key", fal.queueInvalidKey, 401, "PROVIDER_AUTH", /rejected this API key/],
    ["a spent balance", fal.exhaustedBalance, 403, "PROVIDER_BILLING", /balance/],
    [
      "settings it refuses",
      { detail: [{ loc: ["body", "duration"], msg: "bad", type: "value_error" }] },
      422,
      "PROVIDER_REJECTED",
      /settings/,
    ],
  ] as const)("refuses a launch with %s, saying what to do", async (_what, body, status, code, said) => {
    const http = vi.fn().mockResolvedValue(response(body, status));
    expect(await refusal(falAdapter(key, http).createJob({ ...req, durationS: 4 }))).toEqual({
      code,
      detail: expect.stringMatching(said),
    });
  });

  it("checks the key for free with the endpoint's price", async () => {
    const http = vi
      .fn()
      .mockResolvedValueOnce(response(fal.pricing(endpoint)))
      .mockResolvedValueOnce(response(fal.platformInvalidKey, 401));
    const adapter = falAdapter(key, http);
    expect(await adapter.testConnection!()).toEqual({
      ok: true,
      message: `The key works. fal.ai bills ${endpoint} at $0.084 per second, from the account's balance.`,
    });
    expect(await adapter.testConnection!()).toMatchObject({
      ok: false,
      message: expect.stringMatching(/rejected this API key/),
    });
    expect(http.mock.calls[0]![0]).toBe(
      `https://api.fal.ai/v1/models/pricing?endpoint_id=${encodeURIComponent(endpoint)}`,
    );
    expect(http.mock.calls[0]![1]).toEqual({ headers: { authorization: "Key test-key" } });
  });
});

describe("prompt limits", () => {
  it("refuses a prompt longer than Kling takes before any call", async () => {
    const http = vi.fn();
    expect(await refusal(falAdapter("kling-3.0", http).createJob({ ...req, prompt: "x".repeat(2501) }))).toMatchObject({
      code: "PROMPT_TOO_LONG",
    });
    expect(http).not.toHaveBeenCalled();
  });
});
