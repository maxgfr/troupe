import type { FromLibraryWorker, ToLibraryWorker, WorkerTranscript } from "./protocol";

// The page's side of the library worker: one request at a time per call,
// answered by id, and the models' download progress for the page to show.
// A request whose signal aborts (its item was deleted) ends the worker: a
// transcription cannot be interrupted any other way, and the next request
// starts a new one (the models come back from the browser's cache).

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

function setDownload(value: ModelDownload | null) {
  if (value === download) return;
  download = value;
  for (const listener of listeners) listener();
}

// Ends the worker and every request in it.
function stopWorker(reason: Error) {
  worker?.terminate();
  worker = undefined;
  for (const pending of waiting.values()) pending.reject(reason);
  waiting.clear();
  setDownload(null);
}

function libraryWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }: MessageEvent<FromLibraryWorker>) => {
    if (data.type === "download") {
      // Shown only while there is a size to show and bytes still to come.
      setDownload(
        data.totalBytes > 0 && data.loadedBytes < data.totalBytes
          ? { model: data.model, loadedBytes: data.loadedBytes, totalBytes: data.totalBytes }
          : null,
      );
      return;
    }
    const pending = waiting.get(data.id);
    if (!pending) return;
    waiting.delete(data.id);
    if (data.type === "result") pending.resolve(data.value);
    else {
      // A download that failed leaves no bar behind.
      setDownload(null);
      pending.reject(new Error(data.message));
    }
  };
  worker.onerror = (event) =>
    stopWorker(new Error(`The library's worker stopped: ${event.message || "it failed to load"}`));
  return worker;
}

type Request = ToLibraryWorker extends infer M ? (M extends ToLibraryWorker ? Omit<M, "id"> : never) : never;

function ask<T>(message: Request, transfer: Transferable[] = [], signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error("Stopped."));
  const id = next++;
  const stop = () => stopWorker(signal?.reason instanceof Error ? signal.reason : new Error("Stopped."));
  signal?.addEventListener("abort", stop, { once: true });
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
    libraryWorker().postMessage({ ...message, id } as ToLibraryWorker, transfer);
  }).finally(() => signal?.removeEventListener("abort", stop));
}

export const transcribeInWorker = (samples: Float32Array, signal?: AbortSignal) =>
  ask<WorkerTranscript>({ type: "transcribe", samples }, [samples.buffer], signal);
export const embedInWorker = (texts: string[], kind: "query" | "passage", signal?: AbortSignal) =>
  ask<number[][]>({ type: "embed", texts, kind }, [], signal);
