// Messages between the page and the library's worker (site/src/library/worker.ts).

export type ToLibraryWorker =
  | { type: "transcribe"; id: number; samples: Float32Array }
  | { type: "embed"; id: number; texts: string[]; kind: "query" | "passage" };

export type FromLibraryWorker =
  | { type: "result"; id: number; value: unknown }
  | { type: "error"; id: number; message: string }
  | { type: "download"; model: "whisper" | "embeddings"; loadedBytes: number; totalBytes: number };

export interface WorkerTranscript {
  segments: { startS: number; endS: number; text: string }[];
}
