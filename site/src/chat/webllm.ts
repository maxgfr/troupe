import type { InitProgressReport, MLCEngineInterface } from "@mlc-ai/web-llm";

import { ChatProviderError, parseJsonAnswer, type ChatModel } from "~/modules/chat";
import { CHAT_CONFIG } from "./env";

// The browser edition's chat model: WebLLM running a small instruct model on
// the GPU, in a worker, so the page stays responsive while it downloads and
// thinks. Its weights stay in this browser's Cache Storage after the first
// load. WebLLM itself is loaded only when the chat is used.

export type ChatModelStage =
  | { stage: "idle" }
  // Downloading the weights (the first time) or reading them from the cache.
  | { stage: "download"; fraction: number; loadedMb: number }
  | { stage: "load"; fraction: number }
  | { stage: "ready" }
  | { stage: "failed"; message: string };

let current: ChatModelStage = { stage: "idle" };
const listeners = new Set<() => void>();

function set(stage: ChatModelStage) {
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
  if (!gpu) return { ok: false, detail: `The script chat runs its model on the GPU through WebGPU, which this browser lacks. ${USE}` };
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
  support ??= detect().catch((error: unknown) => ({ ok: false as const, detail: `The script chat cannot start here: ${error instanceof Error ? error.message : String(error)}` }));
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

let engine: Promise<MLCEngineInterface> | undefined;

function loadEngine(model: string): Promise<MLCEngineInterface> {
  engine ??= (async () => {
    set({ stage: "download", fraction: 0, loadedMb: 0 });
    const { CreateWebWorkerMLCEngine } = await import("@mlc-ai/web-llm");
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    try {
      const created = await CreateWebWorkerMLCEngine(worker, model, { initProgressCallback: (report) => set(readProgress(report)) });
      set({ stage: "ready" });
      return created;
    } catch (error) {
      worker.terminate();
      throw error;
    }
  })().catch((error: unknown) => {
    engine = undefined;
    const message = `The chat model could not start: ${error instanceof Error ? error.message : String(error)}`;
    set({ stage: "failed", message });
    throw new ChatProviderError(message);
  });
  return engine;
}

const stopped = () => new DOMException("The request was stopped.", "AbortError");

// Waits for `wait`, but not past `signal`: loading the model (a stalled
// download) or another answer ahead can take any time, and a request's time
// limit must end it all the same.
function untilAborted<T>(wait: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return wait;
  if (signal.aborted) return Promise.reject(stopped());
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(stopped());
    signal.addEventListener("abort", stop, { once: true });
    wait.then(
      (value) => {
        signal.removeEventListener("abort", stop);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", stop);
        reject(error);
      },
    );
  });
}

// One answer at a time: the engine holds a single conversation.
let queue: Promise<unknown> = Promise.resolve();
const settled = () => {};

export function webllmChat(model: string): ChatModel {
  return {
    propose(messages, { schema, signal, maxTokens }) {
      const run = async () => {
        const loaded = await untilAborted(loadEngine(model), signal);
        if (signal?.aborted) throw stopped();
        const stop = () => void loaded.interruptGenerate();
        signal?.addEventListener("abort", stop);
        try {
          const reply = await loaded.chat.completions.create({
            messages,
            response_format: { type: "json_object", schema: JSON.stringify(schema) },
            temperature: CHAT_CONFIG.temperature,
            // The model's context is 4,096 tokens in all: a longer answer is held to 3,072.
            max_tokens: Math.min(3072, Math.max(CHAT_CONFIG.maxTokens, maxTokens ?? 0)),
          });
          // Interrupted by the time limit: what it had written is not handed
          // back (no salvage past the limit; the caller says it stopped).
          if (signal?.aborted) throw stopped();
          const text = reply.choices[0]?.message.content ?? "";
          return { text, proposal: parseJsonAnswer(text) };
        } catch (error) {
          if (signal?.aborted) throw stopped();
          throw new ChatProviderError(`The in-browser model could not answer: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          signal?.removeEventListener("abort", stop);
        }
      };
      // Its turn comes after the answer ahead; a request stopped while
      // waiting never runs, and the next one still waits for the one ahead.
      const turn = queue.then(settled, settled);
      const next = untilAborted(turn, signal).then(run);
      queue = Promise.allSettled([turn, next]);
      return next;
    },
  };
}
