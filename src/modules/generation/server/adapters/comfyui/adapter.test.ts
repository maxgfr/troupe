import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";

import { json, startServer } from "~/test/local-server";
import { createComfyAdapter, type ComfyModel } from "./adapter";

const caps = { aspectRatios: ["16:9", "9:16"], resolutions: ["720p"], durationsS: [5], audio: "none" as const, dialogueLanguages: null };
const req = { prompt: "A woman says hello.", aspectRatio: "9:16", resolution: "720p", durationS: 5, audio: false };
const workflow = {
  "6": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}", clip: ["38", 0] } },
  "38": { class_type: "CLIPLoader", inputs: { clip_name: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", type: "wan" } },
  "55": { class_type: "Wan22ImageToVideoLatent", inputs: { width: "{{width}}", height: "{{height}}", length: "{{frames}}", batch_size: 1 } },
  "58": { class_type: "SaveVideo", inputs: { filename_prefix: "{{filename_prefix}}", format: "mp4", codec: "h264" } },
};
let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; });

function model(baseUrl: string, patch: Partial<ComfyModel> = {}): ComfyModel {
  return { modelKey: "local-wan", label: "Wan 2.2 5B", baseUrl, workflow, bindings: [], capabilities: caps, fps: 24, frameRule: "4n+1", sizeTable: { "9:16@720p": [704, 1280] }, ...patch };
}

const done = (outputs: unknown, status: unknown = { status_str: "success", completed: true, messages: [] }) => ({ "p-1": { prompt: [], outputs, status } });

describe("ComfyUI adapter", () => {
  it("binds the workflow, follows the job through history and downloads the MP4 from /view", async () => {
    const clip = await readFile("src/test/fixtures/clip.mp4");
    let historyCalls = 0;
    const server = await startServer((r, res) => {
      if (r.method === "POST" && r.path === "/prompt") return json(res, 200, { prompt_id: "p-1", number: 3, node_errors: {} });
      if (r.path === "/history/p-1") return json(res, 200, ++historyCalls === 1 ? {} : done({ "58": { images: [{ filename: "abc_00001_.mp4", subfolder: "troupe", type: "output" }], animated: [true] } }));
      if (r.path === "/queue") return json(res, 200, { queue_running: [[3, "p-1", {}, {}, ["58"]]], queue_pending: [] });
      if (r.path.startsWith("/view?")) { res.writeHead(200, { "content-type": "video/mp4" }); res.end(clip); return; }
      json(res, 404, {});
    });
    close = server.close;
    const adapter = createComfyAdapter({ model: model(server.url) });

    const { providerJobId } = await adapter.createJob(req);
    const submitted = JSON.parse(server.requests[0]!.body) as { prompt: typeof workflow };
    expect(submitted.prompt["6"].inputs.text).toBe("A woman says hello.");
    expect(submitted.prompt["55"].inputs).toMatchObject({ width: 704, height: 1280, length: 121 });
    expect(submitted.prompt["58"].inputs.filename_prefix).toMatch(/^troupe\/[0-9a-f]{12}$/);

    expect(await adapter.getJob!(providerJobId)).toEqual({ kind: "pending" });
    const completed = await adapter.getJob!(providerJobId);
    expect(completed).toMatchObject({ kind: "completed", outputUrl: `${server.url}/view?filename=abc_00001_.mp4&subfolder=troupe&type=output` });
    const bytes = await adapter.downloadResult!((completed as { outputUrl: string }).outputUrl);
    expect(Buffer.from(bytes).equals(clip)).toBe(true);
  });

  it("finds an MP4 listed under gifs by Video Combine", async () => {
    const server = await startServer((_r, res) => json(res, 200, done({ "9": { gifs: [{ filename: "x.mp4", subfolder: "", type: "output", format: "video/h264-mp4" }] } })));
    close = server.close;
    expect(await createComfyAdapter({ model: model(server.url) }).getJob!("p-1")).toMatchObject({ kind: "completed" });
  });

  it("refuses a non-MP4 output and says what to change", async () => {
    const server = await startServer((_r, res) => json(res, 200, done({ "58": { images: [{ filename: "clip_00001_.webm", subfolder: "", type: "output" }] } })));
    close = server.close;
    expect(await createComfyAdapter({ model: model(server.url) }).getJob!("p-1")).toMatchObject({ kind: "failed", errorCode: "COMFY_UNSUPPORTED_OUTPUT", detail: expect.stringMatching(/\.webm.*mp4/) });
  });

  it("reports a job ComfyUI lost after a restart", async () => {
    const server = await startServer((r, res) => (r.path === "/queue" ? json(res, 200, { queue_running: [], queue_pending: [] }) : json(res, 200, {})));
    close = server.close;
    expect(await createComfyAdapter({ model: model(server.url) }).getJob!("p-1")).toMatchObject({ kind: "failed", errorCode: "COMFY_JOB_LOST" });
  });

  it("surfaces an execution error from history", async () => {
    const status = { status_str: "error", completed: false, messages: [["execution_error", { node_type: "KSampler", exception_message: "MPS backend out of memory" }]] };
    const server = await startServer((_r, res) => json(res, 200, done({}, status)));
    close = server.close;
    expect(await createComfyAdapter({ model: model(server.url) }).getJob!("p-1")).toMatchObject({ kind: "failed", errorCode: "COMFY_EXECUTION_ERROR", detail: "ComfyUI stopped: KSampler: MPS backend out of memory" });
  });

  it("explains a rejected workflow", async () => {
    const server = await startServer((_r, res) => json(res, 400, { error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation" }, node_errors: {} }));
    close = server.close;
    await expect(createComfyAdapter({ model: model(server.url) }).createJob(req)).rejects.toMatchObject({ code: "COMFY_REJECTED", detail: expect.stringMatching(/failed validation.*Test in Settings/) });
  });

  it("refuses to download anything but this server's /view", async () => {
    const adapter = createComfyAdapter({ model: model("http://127.0.0.1:8188") });
    await expect(adapter.downloadResult!("http://evil.example/view?filename=x.mp4")).rejects.toThrow(/outside/);
    await expect(adapter.downloadResult!("http://127.0.0.1:8188/api/userdata/secret")).rejects.toThrow(/outside/);
  });

  it("tests the GPU, missing nodes and missing model files", async () => {
    const server = await startServer((r, res) => {
      if (r.path === "/system_stats") return json(res, 200, { system: { comfyui_version: "0.38.0" }, devices: [{ name: "mps", type: "mps", vram_total: 16 * 1024 ** 3 }] });
      if (r.path === "/object_info") {
        return json(res, 200, {
          CLIPTextEncode: { input: { required: {} } },
          CLIPLoader: { input: { required: { clip_name: ["COMBO", { options: ["other.safetensors"] }] } } },
          SaveVideo: { input: { required: {} } },
        });
      }
      json(res, 404, {});
    });
    close = server.close;
    const report = await createComfyAdapter({
      model: model(server.url, { vramGb: 24, requiredFiles: [{ folder: "text_encoders", filename: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", url: "https://example.com/umt5", nodeClass: "CLIPLoader", input: "clip_name" }] }),
    }).testConnection!();
    expect(report.ok).toBe(false);
    expect(report.message).toMatch(/ComfyUI 0\.38\.0 on mps \(16\.0 GB\)/);
    expect(report.details).toEqual([
      "This workflow wants about 24 GB of VRAM; mps has 16.0 GB.",
      "Missing node: Wan22ImageToVideoLatent. Install or update the custom node pack that provides it, or update ComfyUI.",
      "Missing model file: models/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors — download: https://example.com/umt5",
    ]);
  });
});
