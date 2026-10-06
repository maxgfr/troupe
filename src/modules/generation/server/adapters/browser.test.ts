import { describe, expect, it } from "vitest";

import { AdapterError, type CreateJobRequest } from "../adapter";
import {
  BROWSER_CAPABILITIES,
  BROWSER_MODEL_KEY,
  createBrowserAdapter,
  type BrowserJobState,
  type BrowserRenderJob,
  type BrowserRenderer,
} from "./browser";

const script = {
  lines: [
    { role: "hook" as const, text: "Stop scrolling.", emotion: "excited" as const },
    { role: "cta" as const, text: "Try it tonight.", emotion: "calm" as const },
  ],
  actor: {
    id: "a1111111-1111-4111-8111-111111111111",
    name: "Léa Martin",
    gender: "female" as const,
    ageRange: "25-34",
    voiceProfile: "warm",
  },
  language: "en",
};
const req: CreateJobRequest = {
  prompt: "compiled prompt",
  aspectRatio: "9:16",
  resolution: "720p",
  durationS: 6,
  audio: true,
  script,
};

// A renderer that keeps its jobs in memory and lets the test set their state.
function fakeRenderer() {
  const started: BrowserRenderJob[] = [];
  const states = new Map<string, BrowserJobState>();
  const renderer: BrowserRenderer = {
    async start(job) {
      started.push(job);
      const id = `job-${started.length}`;
      states.set(id, { status: "queued" });
      return id;
    },
    state: async (id) => states.get(id) ?? null,
    result: async (id) => new TextEncoder().encode(`video of ${id}`),
    check: async () => ({ ok: true, message: "This browser can render." }),
  };
  return { renderer, started, states };
}

describe("browser adapter", () => {
  it("declares what the in-browser renderer can make, and asks to be polled every second", () => {
    const adapter = createBrowserAdapter({ renderer: fakeRenderer().renderer });
    expect(adapter).toMatchObject({ modelKey: BROWSER_MODEL_KEY, family: "browser", pollEveryS: 1 });
    expect(adapter.capabilities()).toEqual(BROWSER_CAPABILITIES);
    expect(BROWSER_CAPABILITIES).toMatchObject({
      aspectRatios: ["9:16", "1:1", "16:9"],
      resolutions: ["720p"],
      audio: "always",
      dialogueLanguages: ["en"],
    });
    expect(BROWSER_CAPABILITIES.durationsS[0]).toBe(6);
    expect(BROWSER_CAPABILITIES.durationsS.at(-1)).toBe(30);
  });

  it("starts a render of the script at the format's size", async () => {
    const { renderer, started } = fakeRenderer();
    const adapter = createBrowserAdapter({ renderer });
    expect(await adapter.createJob(req)).toEqual({ providerJobId: "job-1" });
    await adapter.createJob({ ...req, aspectRatio: "16:9" });
    await adapter.createJob({ ...req, aspectRatio: "1:1" });
    expect(started.map((j) => [j.width, j.height])).toEqual([
      [720, 1280],
      [1280, 720],
      [720, 720],
    ]);
    expect(started[0]).toEqual({ width: 720, height: 1280, fps: 24, script });
  });

  it("renders at the frame rate the site is built with", async () => {
    const { renderer, started } = fakeRenderer();
    await createBrowserAdapter({ renderer, fps: 30 }).createJob(req);
    expect(started[0]?.fps).toBe(30);
  });

  it("refuses what it cannot render before starting anything", async () => {
    const { renderer, started } = fakeRenderer();
    const adapter = createBrowserAdapter({ renderer });
    await expect(adapter.createJob({ ...req, resolution: "1080p" })).rejects.toMatchObject({
      code: "UNSUPPORTED_RESOLUTION",
    });
    await expect(adapter.createJob({ ...req, durationS: 4 })).rejects.toMatchObject({ code: "UNSUPPORTED_DURATION" });
    await expect(adapter.createJob({ ...req, script: undefined })).rejects.toMatchObject({ code: "SCRIPT_REQUIRED" });
    expect(started).toEqual([]);
  });

  it("reports a renderer that cannot start as a readable failure", async () => {
    const renderer: BrowserRenderer = {
      ...fakeRenderer().renderer,
      start: () => Promise.reject(new Error("This browser cannot encode H.264 video.")),
    };
    const failure = await createBrowserAdapter({ renderer })
      .createJob(req)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AdapterError);
    expect(failure).toMatchObject({ code: "BROWSER_START_FAILED", detail: "This browser cannot encode H.264 video." });
  });

  it("maps the job's state to the reconciler's", async () => {
    const { renderer, states } = fakeRenderer();
    const adapter = createBrowserAdapter({ renderer });
    const { providerJobId } = await adapter.createJob(req);

    expect(await adapter.getJob!(providerJobId)).toEqual({ kind: "pending" });
    states.set(providerJobId, { status: "running", progress: 0.4 });
    expect(await adapter.getJob!(providerJobId)).toEqual({ kind: "pending", progress: 0.4 });
    states.set(providerJobId, { status: "succeeded" });
    const done = await adapter.getJob!(providerJobId);
    expect(done).toMatchObject({ kind: "completed", providerJobId, eventType: "browser.completed" });
    if (done.kind !== "completed") throw new Error("expected a completed job");
    expect(new TextDecoder().decode(await adapter.downloadResult!(done.outputUrl!))).toBe(`video of ${providerJobId}`);

    states.set(providerJobId, {
      status: "failed",
      detail: "The tab rendering this video was closed before it finished.",
    });
    expect(await adapter.getJob!(providerJobId)).toEqual({
      kind: "failed",
      providerJobId,
      eventType: "browser.failed",
      errorCode: "BROWSER_RENDER_FAILED",
      detail: "The tab rendering this video was closed before it finished.",
    });
  });

  it("fails a job this browser no longer has", async () => {
    const adapter = createBrowserAdapter({ renderer: fakeRenderer().renderer });
    expect(await adapter.getJob!("gone")).toMatchObject({ kind: "failed", errorCode: "BROWSER_JOB_MISSING" });
    await expect(adapter.downloadResult!("https://example.com/video.mp4")).rejects.toThrow(
      /not a render from this browser/,
    );
  });

  it("tests the browser itself", async () => {
    expect(await createBrowserAdapter({ renderer: fakeRenderer().renderer }).testConnection!()).toEqual({
      ok: true,
      message: "This browser can render.",
    });
  });
});
