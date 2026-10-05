import type { FromLibraryWorker, ToLibraryWorker, WorkerTranscript } from "./protocol";

// The page's side of the library worker: one request at a time per call,
// answered by id, and the models' download progress for the page to show.

export interface ModelDownload {
  model: "whisper" | "embeddings";
  loadedBytes: number;
  totalBytes: number;
}

let download: ModelDownload | null = null;
const listeners = new Set<() => void>();

export function subscribeToLibraryDownload(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const libraryDownload = (): ModelDownload | null => download;

let worker: Worker | undefined;
let next = 1;
const waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

function libraryWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }: MessageEvent<FromLibraryWorker>) => {
    if (data.type === "download") {
      download = data.loadedBytes >= data.totalBytes && data.totalBytes > 0 ? null : { model: data.model, loadedBytes: data.loadedBytes, totalBytes: data.totalBytes };
      for (const listener of listeners) listener();
      return;
    }
    const pending = waiting.get(data.id);
    if (!pending) return;
    waiting.delete(data.id);
    if (data.type === "result") pending.resolve(data.value);
    else pending.reject(new Error(data.message));
  };
  worker.onerror = (event) => {
    for (const pending of waiting.values()) pending.reject(new Error(`The library's worker stopped: ${event.message || "it failed to load"}`));
    waiting.clear();
    worker = undefined;
  };
  return worker;
}

type Request = ToLibraryWorker extends infer M ? (M extends ToLibraryWorker ? Omit<M, "id"> : never) : never;

function ask<T>(message: Request, transfer: Transferable[] = []): Promise<T> {
  const id = next++;
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
    libraryWorker().postMessage({ ...message, id } as ToLibraryWorker, transfer);
  });
}

export const transcribeInWorker = (samples: Float32Array) => ask<WorkerTranscript>({ type: "transcribe", samples }, [samples.buffer]);
export const embedInWorker = (texts: string[], kind: "query" | "passage") => ask<number[][]>({ type: "embed", texts, kind });
