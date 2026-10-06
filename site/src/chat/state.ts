import type { InitProgressReport } from "@mlc-ai/web-llm";

import { CHAT_CONFIG } from "./env";

// What the page shows of the browser edition's chat model (./webllm.ts):
// whether this browser can run it, whether its weights are already here, and
// how far it is in loading. Kept apart from the model, which brings the chat
// module's code with it: the shell's notes need only this.

export type ChatModelStage =
  | { stage: "idle" }
  // Downloading the weights (the first time) or reading them from the cache.
  | { stage: "download"; fraction: number; loadedMb: number }
  | { stage: "load"; fraction: number }
  | { stage: "ready" }
  | { stage: "failed"; message: string };

let current: ChatModelStage = { stage: "idle" };
const listeners = new Set<() => void>();

export function setChatModelStage(stage: ChatModelStage) {
  current = stage;
  for (const listener of listeners) listener();
}

// For useSyncExternalStore.
export function subscribeToChatModel(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const chatModelStage = (): ChatModelStage => current;

// WebLLM's progress sentences, as a stage and a figure.
export function readProgress(report: InitProgressReport): ChatModelStage {
  const fraction = Math.min(1, Math.max(0, report.progress));
  const fetched = /^Fetching param cache\[[^\]]*\]: (\d+)MB/.exec(report.text);
  if (fetched) return { stage: "download", fraction, loadedMb: Number(fetched[1]) };
  if (report.text.startsWith("Start to fetch params")) return { stage: "download", fraction: 0, loadedMb: 0 };
  if (/^Finish loading/.test(report.text)) return { stage: "ready" };
  return { stage: "load", fraction };
}

export type ChatSupport = { ok: true; model: string; gpu: string } | { ok: false; detail: string };

const USE = "Open Troupe in a recent Chrome or Edge on a computer with a GPU.";

async function detect(): Promise<ChatSupport> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: ReadonlySet<string>; info?: { vendor?: string } } | null> } }).gpu;
  if (!gpu) return { ok: false, detail: `The chat runs its model on the GPU through WebGPU, which this browser lacks. ${USE}` };
  let adapter: Awaited<ReturnType<typeof gpu.requestAdapter>> = null;
  try {
    adapter = await gpu.requestAdapter();
  } catch {}
  if (!adapter) return { ok: false, detail: `The chat runs on a GPU through WebGPU, and this browser offered none. ${USE}` };
  // 16-bit models need the GPU's shader-f16; the 32-bit build of the same
  // model runs on the rest.
  const model = /q4f16/.test(CHAT_CONFIG.model) && !adapter.features.has("shader-f16") && CHAT_CONFIG.f32Model ? CHAT_CONFIG.f32Model : CHAT_CONFIG.model;
  return { ok: true, model, gpu: adapter.info?.vendor ?? "" };
}

let support: Promise<ChatSupport> | undefined;
export function chatSupport(): Promise<ChatSupport> {
  support ??= detect().catch((error: unknown) => ({ ok: false as const, detail: `The chat cannot start here: ${error instanceof Error ? error.message : String(error)}` }));
  return support;
}

// Whether the weights already sit in WebLLM's cache, read straight from
// Cache Storage so the page does not load WebLLM to ask.
export async function chatModelCached(model: string): Promise<boolean> {
  try {
    if (typeof caches === "undefined") return false;
    const cache = await caches.open("webllm/model");
    const keys = await cache.keys();
    const own = keys.filter((request) => request.url.includes(`/${model}/`));
    return own.some((request) => /(tensor|ndarray)-cache\.json$/.test(request.url)) && own.length > 1;
  } catch {
    return false;
  }
}
