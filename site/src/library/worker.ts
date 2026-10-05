import type { ProgressInfo } from "@huggingface/transformers";

import { LIBRARY_CONFIG } from "./env";
import type { FromLibraryWorker, ToLibraryWorker, WorkerTranscript } from "./protocol";

// The library's models in the browser edition, off the page's main thread:
// Whisper for speech, a sentence-embedding model for search, both through
// transformers.js. Their weights download once from the Hugging Face Hub and
// stay in this browser's Cache Storage ("transformers-cache").

interface Scope {
  postMessage(message: FromLibraryWorker): void;
  onmessage: ((event: MessageEvent<ToLibraryWorker>) => void) | null;
}
const scope = self as unknown as Scope;

type Asr = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string; chunks?: { timestamp: [number, number | null]; text: string }[] }>;
type Extract = (texts: string[], options: Record<string, unknown>) => Promise<{ tolist(): number[][] }>;

async function device(): Promise<"webgpu" | "wasm"> {
  if (LIBRARY_CONFIG.device === "wasm") return "wasm";
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null;
  if (LIBRARY_CONFIG.device === "webgpu" && !adapter) throw new Error("this build runs the library's models on WebGPU, which this browser does not offer");
  return adapter ? "webgpu" : "wasm";
}

function tracker(model: "whisper" | "embeddings") {
  const files = new Map<string, { loaded: number; total: number }>();
  return (event: ProgressInfo) => {
    if (event.status !== "progress" && event.status !== "done") return;
    const previous = files.get(event.file);
    if (event.status === "progress") files.set(event.file, { loaded: event.loaded, total: event.total });
    else if (previous) files.set(event.file, { loaded: previous.total, total: previous.total });
    let loadedBytes = 0;
    let totalBytes = 0;
    for (const f of files.values()) {
      loadedBytes += f.loaded;
      totalBytes += f.total;
    }
    scope.postMessage({ type: "download", model, loadedBytes, totalBytes });
  };
}

async function transformers() {
  const module = await import("@huggingface/transformers");
  module.env.allowLocalModels = false;
  module.env.useBrowserCache = true;
  const wasm = module.env.backends.onnx.wasm;
  if (wasm) {
    // One thread: the site is served without the headers that share memory.
    wasm.numThreads = 1;
    // The site ships ONNX Runtime's WebAssembly itself (as for the voices).
    wasm.wasmPaths = undefined;
  }
  return module;
}

let asr: Promise<Asr> | undefined;
let extractor: Promise<Extract> | undefined;

function loadAsr(): Promise<Asr> {
  asr ??= (async () => {
    const { pipeline } = await transformers();
    const where = await device();
    return (await pipeline("automatic-speech-recognition", LIBRARY_CONFIG.whisperModel, { dtype: LIBRARY_CONFIG.whisperDtype as "q8", device: where, progress_callback: tracker("whisper") })) as unknown as Asr;
  })().catch((error: unknown) => {
    asr = undefined;
    throw error;
  });
  return asr;
}

function loadExtractor(): Promise<Extract> {
  extractor ??= (async () => {
    const { pipeline } = await transformers();
    const where = await device();
    return (await pipeline("feature-extraction", LIBRARY_CONFIG.embedModel, { dtype: LIBRARY_CONFIG.embedDtype as "q8", device: where, progress_callback: tracker("embeddings") })) as unknown as Extract;
  })().catch((error: unknown) => {
    extractor = undefined;
    throw error;
  });
  return extractor;
}

async function transcribe(samples: Float32Array): Promise<WorkerTranscript> {
  const run = await loadAsr();
  const out = await run(samples, { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5, task: "transcribe" });
  const end = samples.length / 16000;
  const segments = (out.chunks ?? [])
    .map((c) => ({ startS: c.timestamp[0] ?? 0, endS: c.timestamp[1] ?? end, text: c.text.trim() }))
    .filter((s) => s.text && Number.isFinite(s.startS));
  if (segments.length === 0 && out.text.trim()) segments.push({ startS: 0, endS: end, text: out.text.trim() });
  return { segments };
}

// e5 models were trained with these prefixes.
const prefix = (kind: "query" | "passage") => (/e5/i.test(LIBRARY_CONFIG.embedModel) ? `${kind}: ` : "");

async function embed(texts: string[], kind: "query" | "passage"): Promise<number[][]> {
  const run = await loadExtractor();
  const output = await run(texts.map((t) => `${prefix(kind)}${t}`), { pooling: "mean", normalize: true });
  return output.tolist();
}

// One request at a time: each takes the whole thread.
let queue: Promise<void> = Promise.resolve();

scope.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      const value = data.type === "transcribe" ? await transcribe(data.samples) : await embed(data.texts, data.kind);
      scope.postMessage({ type: "result", id: data.id, value });
    } catch (error) {
      scope.postMessage({ type: "error", id: data.id, message: error instanceof Error ? error.message : String(error) });
    }
  });
};
