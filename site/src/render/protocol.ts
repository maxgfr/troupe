import type { BrowserRenderJob } from "~/modules/generation";

// Messages between the page (runner.ts) and the render worker (worker.ts).

// Where a render is, for the progress shown under it.
export type RenderStage =
  | { stage: "queued" }
  // The Kokoro weights, from Cache Storage after the first time.
  | { stage: "model"; loadedBytes: number; totalBytes: number; device: VoiceDevice }
  | { stage: "voice"; line: number; lines: number; device: VoiceDevice }
  | { stage: "frames"; frame: number; frames: number }
  | { stage: "saving" };

// WebGPU when the browser has it, else WebAssembly on one CPU thread.
export type VoiceDevice = "webgpu" | "wasm";

export type ToWorker = { type: "render"; jobId: string; job: BrowserRenderJob };

export type FromWorker =
  | { type: "progress"; jobId: string; stage: RenderStage }
  | { type: "done"; jobId: string; video: Blob }
  | { type: "failed"; jobId: string; message: string };

// The share of the whole render a stage stands for: voicing first, then
// drawing and encoding, as in the Node renderer's progress.
const VOICE_SHARE = 0.3;
export function overallProgress(stage: RenderStage): number {
  switch (stage.stage) {
    case "queued":
    case "model":
      return 0;
    case "voice":
      return (VOICE_SHARE * stage.line) / Math.max(1, stage.lines);
    case "frames":
      return VOICE_SHARE + ((1 - VOICE_SHARE) * stage.frame) / Math.max(1, stage.frames);
    case "saving":
      return 1;
  }
}
