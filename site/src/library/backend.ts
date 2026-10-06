import type { ChatBackend } from "~/modules/chat";
import { requeueStale, runLibraryQueue, type AnalysisTools, type ClaimedUpload, type LibraryBackend, type LibraryStatus } from "~/modules/library";
import type { Db } from "~/server/db/types";
import { browserMedia } from "../media";
import { embedInWorker, transcribeInWorker } from "./client";
import { LIBRARY_CONFIG } from "./env";
import { browserMediaReader } from "./media";

// The browser edition's ctx.library: everything runs in this tab and its
// worker (Whisper and the embedding model through transformers.js), the
// script chat's WebLLM writes, and files stay in this browser. No server
// means no link fetching, and no vision model small enough to run here yet,
// which the status says.

const NO_LINKS = "A page in your browser cannot fetch other sites. Save the video or the page to a file and upload it, or paste its text.";
const NO_VISION = "Pictures are taken from videos, but describing them needs a vision model, which runs in the self-hosted studio.";

// Uploads the page has stored and not yet recorded, by item id: the router
// runs in this same page, so a plain map hands them over.
export const pendingUploads = new Map<string, ClaimedUpload>();

// The analysis queue: one tab at a time analyses (Web Locks); while it holds
// the lock nobody else analyses, so an item still "analyzing" was cut short.
const LOCK = "troupe-library-analysis";
let running: Promise<void> | null = null;
let again = false;

const MODEL = (id: string) => id.split("/").pop() ?? id;

export function createBrowserLibrary(db: Db, chat: ChatBackend): LibraryBackend {
  async function tools(): Promise<AnalysisTools> {
    const setup = await chat.load();
    return {
      media: browserMediaReader(db),
      transcriber: {
        ready: true,
        tool: {
          model: MODEL(LIBRARY_CONFIG.whisperModel),
          async transcribe(audio, options) {
            if (audio.kind !== "samples") throw new Error("The browser's transcriber takes decoded sound.");
            const { segments } = await transcribeInWorker(audio.samples, options.signal);
            return { language: null, model: MODEL(LIBRARY_CONFIG.whisperModel), segments };
          },
        },
      },
      vision: { ready: false, problem: NO_VISION },
      embedder: { ready: true, tool: { model: MODEL(LIBRARY_CONFIG.embedModel), embed: (texts, kind, options) => embedInWorker(texts, kind, options?.signal) } },
      writer: setup.model ? { ready: true, tool: setup.model, label: setup.label, modelId: setup.modelId } : { ready: false, problem: setup.problem ?? "The in-browser chat model cannot run here." },
    };
  }

  function schedule() {
    if (running) {
      again = true;
      return;
    }
    running = (async () => {
      const work = async () => {
        await requeueStale(db, 0);
        do {
          again = false;
          await runLibraryQueue(db, tools, { maxFrames: LIBRARY_CONFIG.frames, removeFiles: (files) => browserMedia.remove(files.map((f) => ({ storagePath: f.storagePath, storage: "local" as const }))) });
        } while (again);
      };
      if (navigator.locks) await navigator.locks.request(LOCK, work);
      else await work();
    })()
      .catch((error: unknown) => console.warn("The library's analysis stopped:", error))
      .finally(() => {
        running = null;
      });
  }

  return {
    edition: "browser",
    tools,
    schedule,
    async status(): Promise<LibraryStatus> {
      const t = await tools();
      return {
        edition: "browser",
        maxUploadBytes: LIBRARY_CONFIG.maxUploadMb * 1024 * 1024,
        tools: [
          { name: "transcription", label: "Transcription", ready: true, model: MODEL(LIBRARY_CONFIG.whisperModel), detail: "Speech is transcribed in this tab, by Whisper on your computer." },
          { name: "vision", label: "Pictures", ready: false, model: null, detail: NO_VISION },
          { name: "embeddings", label: "Search by meaning", ready: true, model: MODEL(LIBRARY_CONFIG.embedModel), detail: "Passages are indexed by meaning in this tab." },
          { name: "writer", label: "Analysis and ideas", ready: t.writer.ready, model: t.writer.ready ? (t.writer.modelId ?? null) : null, detail: t.writer.ready ? "Hooks, structure, tags, the library chat and ideas are written by the in-browser chat model, on your GPU." : t.writer.problem },
          { name: "links", label: "Links", ready: false, model: null, detail: NO_LINKS },
        ],
      };
    },
    async claimUpload(uploadId) {
      const upload = pendingUploads.get(uploadId);
      if (!upload) throw new Error("That upload is no longer waiting in this tab. Upload the file again.");
      pendingUploads.delete(uploadId);
      return upload;
    },
    async removeFiles(files) {
      await browserMedia.remove(files.map((f) => ({ storagePath: f.storagePath, storage: "local" as const })));
    },
  };
}
