import type { ChatModel } from "~/modules/chat";

// The inspiration library: what the user saves (files, pasted text, links),
// what the studio reads out of it, and the seam between the analysis and
// whatever runs it (the self-hosted studio in src/server/library, the
// browser edition in site/src/library). The router only sees ctx.library.

export const ITEM_KINDS = ["video", "audio", "image", "pdf", "text", "article"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const ITEM_STATUSES = ["queued", "analyzing", "ready", "failed"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export interface TranscriptSegment {
  startS: number;
  endS: number;
  text: string;
}

export interface Transcript {
  // ISO 639-1 code, as Whisper detects it.
  language: string | null;
  segments: TranscriptSegment[];
  // The model that wrote it, e.g. "faster-whisper base".
  model: string;
}

// One picture taken from a video (or the image itself), with what the vision
// model saw in it.
export interface Frame {
  assetId: string;
  atS: number;
  description?: string;
  // Text visible in the picture (captions, titles), as the model read it.
  text?: string;
}

export const ANALYSIS_STEPS = ["frames", "transcript", "vision", "insights", "embeddings"] as const;
export type AnalysisStepName = (typeof ANALYSIS_STEPS)[number];

export interface AnalysisStep {
  name: AnalysisStepName;
  status: "done" | "skipped" | "failed";
  // Why it was skipped or failed, in a sentence.
  detail?: string;
}

export interface StructurePart {
  part: "hook" | "body" | "cta";
  startS?: number;
  endS?: number;
  summary: string;
}

export type Pace = "slow" | "steady" | "fast";

export interface ItemAnalysis {
  version: 1;
  language?: string | null;
  transcript?: Transcript;
  frames?: Frame[];
  // What the first 3 seconds say (or the opening line of a text).
  hook?: { text: string; endS?: number; why?: string };
  structure?: StructurePart[];
  pacing?: { wordsPerSecond?: number; cutsPerMinute?: number; pace: Pace };
  tone?: string[];
  summary?: string;
  // The model that wrote the hook, structure, tone and tags.
  insightsModel?: string;
  steps: AnalysisStep[];
}

// Where an answer from the library chat comes from.
export interface Citation {
  // The [n] the answer uses.
  n: number;
  itemId: string;
  chunkId: string;
  title: string;
  kind: ItemKind;
  startS: number | null;
}

// A transcription engine: Whisper on the stack's renderer, or in the page.
export interface Transcriber {
  model: string;
  transcribe(audio: AudioSource, options: { signal?: AbortSignal }): Promise<Transcript>;
}

// Whatever the edition hands its transcriber: a file on the server, decoded
// samples in the browser.
export type AudioSource = { kind: "file"; path: string } | { kind: "samples"; samples: Float32Array; sampleRate: number };

// A local vision model reading pictures.
export interface Vision {
  model: string;
  read(picture: { bytes: Uint8Array; mimeType: string }, options: { signal?: AbortSignal }): Promise<{ description: string; text: string }>;
}

// A local embedding model. `kind` lets models that expect a prefix
// ("query: " / "passage: ") get it.
export interface Embedder {
  model: string;
  embed(texts: string[], kind: "query" | "passage", options?: { signal?: AbortSignal }): Promise<number[][]>;
}

// Pictures and sound out of a stored video or audio file.
export interface MediaReader {
  // Length in seconds, and whether there is a picture and a sound track.
  probe(item: StoredItemFile): Promise<{ durationS: number | null; hasVideo: boolean; hasAudio: boolean }>;
  // The opening frame, one after each cut (up to `max`), stored as media
  // assets of the item; and every cut's time, for the pacing.
  frames(item: StoredItemFile, options: { max: number; durationS: number | null; signal?: AbortSignal }): Promise<{ frames: { assetId: string; atS: number }[]; cutsAtS: number[] }>;
  audio(item: StoredItemFile, options: { signal?: AbortSignal }): Promise<AudioSource & { dispose?: () => Promise<void> }>;
  // The bytes of a stored picture (a frame or an image item), for vision.
  picture(assetId: string): Promise<{ bytes: Uint8Array; mimeType: string }>;
  // Text out of a PDF.
  pdfText?(item: StoredItemFile): Promise<string>;
}

export interface StoredItemFile {
  itemId: string;
  workspaceId: string;
  assetId: string;
  storagePath: string;
  mimeType: string;
}

// Each tool, or why it cannot run here (a sentence for the page).
export type Tool<T> = { ready: true; tool: T } | { ready: false; problem: string };

export interface AnalysisTools {
  media: MediaReader | null;
  transcriber: Tool<Transcriber>;
  vision: Tool<Vision>;
  embedder: Tool<Embedder>;
  // The script chat's model, which also writes the analysis and the ideas.
  writer: Tool<ChatModel> & { label?: string; modelId?: string };
}

// One line of the library's status, for Settings, the library page and
// `troupe doctor`.
export interface ToolStatus {
  name: "transcription" | "vision" | "embeddings" | "writer" | "links" | "video-links";
  label: string;
  ready: boolean;
  // The model or program, e.g. "qwen3-embedding:0.6b".
  model: string | null;
  detail: string;
}

export interface LibraryStatus {
  edition: "self-hosted" | "browser";
  tools: ToolStatus[];
  // The largest upload, in bytes.
  maxUploadBytes: number;
}

// A page or file fetched from a link (self-hosted only).
export type FetchedSource =
  | { kind: "article"; url: string; title: string; text: string; siteName?: string | null }
  | { kind: "file"; url: string; title: string; path: string; mimeType: string; bytes: number; checksum: string; durationS?: number | null; dispose: () => Promise<void> };

// An upload already stored by the edition (the browser edition's own files).
export interface ClaimedUpload {
  assetId: string;
  storagePath: string;
  mimeType: string;
  bytes: number;
  checksum: string;
  fileName: string;
}

// Injected through the tRPC context (ctx.library).
export interface LibraryBackend {
  edition: "self-hosted" | "browser";
  status(): Promise<LibraryStatus>;
  // Read each time: a change in Settings (the chat's model) applies at once.
  tools(): Promise<AnalysisTools>;
  // Starts (or wakes) the analysis queue; returns at once.
  schedule(): void;
  // Self-hosted only: fetches a page or a video for the library.
  fetchUrl?(url: string, options: { signal?: AbortSignal }): Promise<FetchedSource>;
  // Browser edition only: an upload the page has already stored.
  claimUpload?(uploadId: string): Promise<ClaimedUpload>;
  // Stores a fetched file as a media asset of the workspace.
  adoptFile?(source: Extract<FetchedSource, { kind: "file" }>, target: { workspaceId: string; itemId: string }): Promise<ClaimedUpload>;
  // Deletes stored files once their rows are gone (best effort).
  removeFiles(files: { storagePath: string }[]): Promise<void>;
}

// A failure the user can act on, said in a sentence.
export class LibraryError extends Error {
  constructor(
    message: string,
    readonly code: "BAD_REQUEST" | "NOT_FOUND" | "PRECONDITION_FAILED" = "BAD_REQUEST",
  ) {
    super(message);
    this.name = "LibraryError";
  }
}
