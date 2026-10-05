import { sizeFor } from "~/modules/models/geometry";
import { AdapterError, validateRequest, type ConnectionReport, type JobScript, type ModelCapabilities, type VideoProviderAdapter } from "../adapter";

// The renderer of the browser edition (site/src/render): Kokoro voices the
// script and the shared scene is drawn and encoded, all in the visitor's
// browser. The page provides the renderer; this adapter only talks to it.

export const BROWSER_MODEL_KEY = "browser";
export const BROWSER_MODEL_LABEL = "Kokoro voice + captions";

export const BROWSER_CAPABILITIES: ModelCapabilities = {
  aspectRatios: ["9:16", "1:1", "16:9"],
  resolutions: ["720p"],
  durationsS: Array.from({ length: 25 }, (_, i) => 6 + i),
  audio: "always",
  // Kokoro's voices are English.
  dialogueLanguages: ["en"],
};

// The Node renderer's frame rate (renderer/src/request.ts), so both make the same video.
const DEFAULT_FPS = 24;
const OUTPUT_PREFIX = "browser-render:";

export interface BrowserRenderJob {
  width: number;
  height: number;
  fps: number;
  script: JobScript;
}

export type BrowserJobState =
  | { status: "queued" | "running"; progress?: number }
  | { status: "succeeded" }
  | { status: "failed"; detail: string };

export interface BrowserRenderer {
  // Queues a render and returns its id.
  start(job: BrowserRenderJob): Promise<string>;
  // Null when this browser has no such job (its site data was cleared).
  state(jobId: string): Promise<BrowserJobState | null>;
  // The finished MP4.
  result(jobId: string): Promise<Uint8Array>;
  // Whether this browser can render, in words.
  check(): Promise<ConnectionReport>;
}

export function createBrowserAdapter(deps: { renderer: BrowserRenderer; modelKey?: string; fps?: number }): VideoProviderAdapter {
  const { renderer } = deps;
  const fps = deps.fps ?? DEFAULT_FPS;
  return {
    modelKey: deps.modelKey ?? BROWSER_MODEL_KEY,
    family: "browser",
    modelId: BROWSER_MODEL_LABEL,
    // A render takes seconds and runs in this tab: check on it often.
    pollEveryS: 1,
    capabilities: () => BROWSER_CAPABILITIES,
    async createJob(req) {
      validateRequest(BROWSER_CAPABILITIES, req);
      if (!req.script) throw new AdapterError("SCRIPT_REQUIRED", "This model voices a script: launch it from a project with a script.");
      const { width, height } = sizeFor(req.aspectRatio, req.resolution);
      try {
        return { providerJobId: await renderer.start({ width, height, fps, script: req.script }) };
      } catch (error) {
        throw new AdapterError("BROWSER_START_FAILED", error instanceof Error ? error.message : "The render could not start in this browser.");
      }
    },
    async getJob(providerJobId) {
      const state = await renderer.state(providerJobId);
      if (!state) {
        return { kind: "failed", providerJobId, eventType: "browser.failed", errorCode: "BROWSER_JOB_MISSING", detail: "This render is no longer in this browser. Relaunch it." };
      }
      // The scene draws the captions into every frame.
      if (state.status === "succeeded") return { kind: "completed", providerJobId, eventType: "browser.completed", outputUrl: `${OUTPUT_PREFIX}${providerJobId}`, captions: "burned" };
      if (state.status === "failed") return { kind: "failed", providerJobId, eventType: "browser.failed", errorCode: "BROWSER_RENDER_FAILED", detail: state.detail };
      return { kind: "pending", ...(state.progress !== undefined ? { progress: state.progress } : {}) };
    },
    async downloadResult(url) {
      if (!url.startsWith(OUTPUT_PREFIX)) throw new Error(`${url} is not a render from this browser.`);
      return renderer.result(url.slice(OUTPUT_PREFIX.length));
    },
    testConnection: () => renderer.check(),
  };
}
