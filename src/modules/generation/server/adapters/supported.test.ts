import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_MODELS } from "~/modules/models";
import { createFalAdapter } from "./fal";
import { createVeoTextAdapter } from "./veo-text";
import { downloadFalVideo } from "./download";

const req = { prompt: "A person says hello.", aspectRatio: "9:16", durationS: 8, resolution: "720p", audio: true };
const response = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data });
const builtin = (key: string) => BUILTIN_MODELS.find((m) => m.key === key)!;
const falModel = (key: string) => {
  const m = builtin(key);
  return {
    modelKey: m.key,
    provider: key,
    endpoint: m.modelId,
    capabilities: m.capabilities,
    sendsResolution: m.sendsResolution ?? false,
  };
};
const veoModel = () => {
  const m = builtin("veo-3.1-fast");
  return { modelKey: m.key, modelId: m.modelId, capabilities: m.capabilities };
};
afterEach(() => vi.unstubAllGlobals());

describe("supported video contracts", () => {
  it.each(["kling-3.0", "seedance-1.5-pro"])("submits and polls %s using fal's returned queue URLs", async (key) => {
    const queue = {
      request_id: "test-request",
      status_url: "https://queue.fal.run/test/requests/test-request/status",
      response_url: "https://queue.fal.run/test/requests/test-request",
    };
    const http = vi
      .fn()
      .mockResolvedValueOnce(response(queue))
      .mockResolvedValueOnce(response({ status: "IN_QUEUE" }))
      .mockResolvedValueOnce(response({ status: "COMPLETED" }))
      .mockResolvedValueOnce(response({ video: { url: "https://v3.fal.media/test.mp4" } }));
    const adapter = createFalAdapter({ model: falModel(key), apiKey: "test-key", http });
    const job = await adapter.createJob(req);
    expect(JSON.parse(http.mock.calls[0]![1].body)).toMatchObject({
      duration: "8",
      aspect_ratio: "9:16",
      generate_audio: true,
    });
    expect(http.mock.calls[0]![1].headers.authorization).toBe("Key test-key");
    expect(await adapter.getJob!(job.providerJobId)).toEqual({ kind: "pending" });
    expect(await adapter.getJob!(job.providerJobId)).toMatchObject({
      kind: "completed",
      outputUrl: "https://v3.fal.media/test.mp4",
    });
    expect(http.mock.calls[1]![0]).toBe(queue.status_url);
    expect(http.mock.calls[3]![0]).toBe(queue.response_url);
  });

  it("forwards the audio choice and only sends a resolution where the endpoint takes one", async () => {
    const queue = { request_id: "r", status_url: "https://queue.fal.run/s", response_url: "https://queue.fal.run/r" };
    const http = vi.fn().mockResolvedValue(response(queue));
    await createFalAdapter({ model: falModel("seedance-1.5-pro"), apiKey: "k", http }).createJob({
      ...req,
      audio: false,
      resolution: "1080p",
    });
    await createFalAdapter({ model: falModel("kling-3.0"), apiKey: "k", http }).createJob({ ...req, audio: false });
    expect(JSON.parse(http.mock.calls[0]![1].body)).toMatchObject({ generate_audio: false, resolution: "1080p" });
    expect(JSON.parse(http.mock.calls[1]![1].body)).not.toHaveProperty("resolution");
  });

  it("never sends the fal key to a foreign queue URL", async () => {
    const http = vi.fn().mockResolvedValue(
      response({
        request_id: "x",
        status_url: "https://evil.example/status",
        response_url: "https://queue.fal.run/result",
      }),
    );
    await expect(
      createFalAdapter({ model: falModel("kling-3.0"), apiKey: "test-key", http }).createJob(req),
    ).rejects.toThrow("Invalid fal");
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("parses Google's long-running operation and filtered results", async () => {
    const http = vi
      .fn()
      .mockResolvedValueOnce(response({ name: "models/veo-3.1-fast-generate-preview/operations/test" }))
      .mockResolvedValueOnce(
        response({
          name: "operations/test",
          done: true,
          response: {
            generateVideoResponse: {
              generatedSamples: [
                { video: { uri: "https://generativelanguage.googleapis.com/v1beta/files/test:download" } },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          name: "operations/test",
          done: true,
          response: { generateVideoResponse: { raiMediaFilteredCount: 1 } },
        }),
      );
    const adapter = createVeoTextAdapter({ model: veoModel(), http, apiKey: "test-key" });
    const job = await adapter.createJob(req);
    expect(http.mock.calls[0]![0]).toContain("veo-3.1-fast-generate-preview:predictLongRunning");
    expect(JSON.parse(http.mock.calls[0]![1].body).parameters.durationSeconds).toBe(8);
    expect(await adapter.getJob!(job.providerJobId)).toMatchObject({ kind: "completed" });
    expect(await adapter.getJob!(job.providerJobId)).toMatchObject({
      kind: "failed",
      errorCode: "NO_VIDEO_RETURNED",
      detail: expect.stringMatching(/safety/),
    });
    await expect(adapter.getJob!("https://evil.example")).rejects.toThrow();
  });

  it("tests a Google key by reading the model, without generating", async () => {
    const http = vi
      .fn()
      .mockResolvedValueOnce(response({ name: "models/veo" }))
      .mockResolvedValueOnce(response({}, 403));
    const adapter = createVeoTextAdapter({ model: veoModel(), http, apiKey: "k" });
    expect(await adapter.testConnection!()).toMatchObject({ ok: true });
    expect(await adapter.testConnection!()).toMatchObject({ ok: false });
    expect(http.mock.calls[0]![0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-preview",
    );
    expect(http.mock.calls[0]![1].method).toBeUndefined();
  });

  it("drops Google's API key at the signed download redirect", async () => {
    const bytes = Buffer.from("0000ftypisom0000");
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://storage.googleapis.com/test.mp4?signed=yes" },
        }),
      )
      .mockResolvedValueOnce(new Response(bytes));
    vi.stubGlobal("fetch", fetcher);
    const adapter = createVeoTextAdapter({ model: veoModel(), http: vi.fn(), apiKey: "test-key" });
    expect(
      await adapter.downloadResult!("https://generativelanguage.googleapis.com/v1beta/files/test:download"),
    ).toEqual(bytes);
    expect(fetcher.mock.calls[0]![1].headers).toEqual({ "x-goog-api-key": "test-key" });
    expect(fetcher.mock.calls[1]![1].headers).toBeUndefined();
    await expect(downloadFalVideo("https://localhost/test.mp4")).rejects.toThrow();
  });
});
