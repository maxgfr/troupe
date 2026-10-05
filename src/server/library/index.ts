import "server-only";

import type { ChatBackend } from "~/modules/chat";
import { LibraryError, requeueStale, runLibraryQueue, type AnalysisTools, type LibraryBackend, type LibraryStatus, type Tool, type ToolStatus } from "~/modules/library";
import type { Db } from "~/server/db/types";
import { libraryEnvironment, type LibraryEnvironment } from "./config";
import { fetchSource } from "./fetch";
import { cleanFileName, receiveFile, removeLibraryFiles } from "./files";
import { serverMediaReader } from "./media";
import { hasModel, ollamaEmbedder, ollamaVision, pulledModels } from "./ollama";
import { rendererTranscriber, transcriberHealth } from "./transcribe";
import { ytDlpVersion } from "./ytdlp";

// The self-hosted studio's library: files in the data folder, ffmpeg for
// pictures and sound, the stack's renderer for Whisper, Ollama for
// embeddings and vision, the script chat's model for the writing, yt-dlp
// for video links. Analyses run one at a time in this process.

type Env = Record<string, string | undefined>;

// Readiness is checked at most this often: the queue asks for each item.
const STATUS_TTL_MS = 30_000;

interface Probe {
  at: number;
  pulled: Set<string> | null;
  ollamaProblem: string | null;
  transcriber: { ok: true; model: string } | { ok: false; problem: string };
  ytDlp: string | null;
}

const state = globalThis as unknown as { troupeLibraryProbe?: Probe; troupeLibraryQueue?: { running: Promise<void> | null; again: boolean } };

async function probe(env: LibraryEnvironment, force = false): Promise<Probe> {
  const cached = state.troupeLibraryProbe;
  if (cached && !force && Date.now() - cached.at < STATUS_TTL_MS) return cached;
  const target = { baseUrl: env.ollamaUrl, timeoutMs: env.ollamaTimeoutMs };
  const [ollama, transcriber, ytDlp] = await Promise.all([
    env.embedModel || env.visionModel
      ? pulledModels(target).then(
          (pulled) => ({ pulled, problem: null }),
          (error: Error) => ({ pulled: null, problem: error.message }),
        )
      : Promise.resolve({ pulled: null, problem: null }),
    env.transcribeUrl
      ? transcriberHealth({ baseUrl: env.transcribeUrl, token: env.transcribeToken, timeoutMs: env.transcribeTimeoutMs })
      : Promise.resolve({ ok: false as const, problem: "Transcription is off: set TROUPE_TRANSCRIBE_URL to a renderer with Whisper (docs/LIBRARY.md)." }),
    ytDlpVersion(env.ytDlpPath),
  ]);
  const next: Probe = { at: Date.now(), pulled: ollama.pulled, ollamaProblem: ollama.problem, transcriber, ytDlp };
  state.troupeLibraryProbe = next;
  return next;
}

function modelTool<T>(model: string | null, p: Probe, name: string, envName: string, make: (model: string) => T): Tool<T> & { model: string | null } {
  if (!model) return { ready: false, problem: `The ${name} model is off (${envName}).`, model: null };
  if (!p.pulled) return { ready: false, problem: `${p.ollamaProblem ?? "Ollama cannot be reached."} The ${name} step waits for it.`, model };
  if (!hasModel(p.pulled, model)) return { ready: false, problem: `Ollama does not have ${model} yet (the Docker stack downloads it after the chat model; otherwise run \`ollama pull ${model}\`).`, model };
  return { ready: true, tool: make(model), model };
}

export function createServerLibrary(db: Db, chat: ChatBackend | null, options: { env?: Env } = {}): LibraryBackend | null {
  const env = libraryEnvironment(options.env ?? process.env);
  if (!env.enabled) return null;
  const ollama = { baseUrl: env.ollamaUrl, timeoutMs: env.ollamaTimeoutMs };

  async function tools(force = false): Promise<AnalysisTools> {
    const p = await probe(env, force);
    const setup = chat ? await chat.load() : null;
    return {
      media: serverMediaReader(db, { ffmpegPath: env.ffmpegPath }),
      transcriber: p.transcriber.ok
        ? { ready: true, tool: rendererTranscriber({ baseUrl: env.transcribeUrl!, token: env.transcribeToken, timeoutMs: env.transcribeTimeoutMs }, p.transcriber.model) }
        : { ready: false, problem: p.transcriber.problem },
      vision: modelTool(env.visionModel, p, "vision", "TROUPE_LIBRARY_VISION_MODEL", (m) => ollamaVision(ollama, m)),
      embedder: modelTool(env.embedModel, p, "embedding", "TROUPE_LIBRARY_EMBED_MODEL", (m) => ollamaEmbedder(ollama, m)),
      writer: setup?.model
        ? { ready: true, tool: setup.model, label: setup.label, modelId: setup.modelId }
        : { ready: false, problem: setup?.problem ?? "No chat model is set up, so the library cannot write its analysis. Choose one in Settings." },
    };
  }

  function schedule() {
    state.troupeLibraryQueue ??= { running: null, again: false };
    const queue = state.troupeLibraryQueue;
    if (queue.running) {
      queue.again = true;
      return;
    }
    queue.running = (async () => {
      do {
        queue.again = false;
        await runLibraryQueue(db, () => tools(), {
          maxFrames: env.frames,
          visionFrames: env.visionFrames,
          removeFiles: removeLibraryFiles,
          log: (event) => console.info(JSON.stringify(event)),
        });
      } while (queue.again);
    })()
      .catch((error: unknown) => console.error(JSON.stringify({ event: "library.queue.failed", message: error instanceof Error ? error.message : String(error) })))
      .finally(() => {
        queue.running = null;
      });
  }

  return {
    edition: "self-hosted",
    tools: () => tools(),
    schedule,
    async status(): Promise<LibraryStatus> {
      const p = await probe(env, true);
      const t = await tools();
      const line = (name: ToolStatus["name"], label: string, tool: Tool<unknown>, model: string | null, ok: string): ToolStatus => ({ name, label, ready: tool.ready, model, detail: tool.ready ? ok : tool.problem });
      return {
        edition: "self-hosted",
        maxUploadBytes: env.maxUploadBytes,
        tools: [
          line("transcription", "Transcription", t.transcriber, p.transcriber.ok ? p.transcriber.model : null, "Speech in videos and sound files is transcribed by the stack's renderer."),
          line("vision", "Pictures", t.vision, env.visionModel, "Frames are described, and their on-screen text read, by Ollama."),
          line("embeddings", "Search by meaning", t.embedder, env.embedModel, "Passages are indexed by meaning by Ollama."),
          line("writer", "Analysis and ideas", t.writer, t.writer.ready ? (t.writer.modelId ?? null) : null, "Hooks, structure, tags, the library chat and ideas are written by the script chat's model."),
          { name: "links", label: "Links to pages", ready: true, model: null, detail: env.allowPrivateUrls ? "Pages and files at any address are saved, your network included (TROUPE_LIBRARY_ALLOW_PRIVATE_URLS)." : "Public pages are saved as articles, direct links to files as files." },
          p.ytDlp
            ? { name: "video-links", label: "Video links", ready: true, model: `yt-dlp ${p.ytDlp}`, detail: "Links to YouTube, TikTok, Instagram, Vimeo and other platforms are downloaded with yt-dlp." }
            : { name: "video-links", label: "Video links", ready: false, model: null, detail: "yt-dlp is not installed on this server, so links to video platforms cannot be saved; upload the file instead (docs/LIBRARY.md)." },
        ],
      };
    },
    fetchUrl: (url, opts) => fetchSource(url, env, opts),
    async adoptFile(source, target) {
      const received = await receiveFile(source.path, { itemId: target.itemId, fileName: cleanFileName(source.title || "download"), maxBytes: env.maxUploadBytes });
      if (received.kind !== "file") throw new LibraryError("That link is a text file; paste its text instead.");
      return received.file;
    },
    removeFiles: removeLibraryFiles,
  };
}

// The worker loop's pass (TROUPE_INPROCESS_WORKER): an analysis cut short
// by a restart goes back in the queue, and the queue runs.
export async function libraryPass(db: Db, chat: ChatBackend | null): Promise<void> {
  const library = createServerLibrary(db, chat);
  if (!library) return;
  // This process is the only one analysing: with its queue idle, an item
  // still marked "analyzing" was cut short.
  const requeued = state.troupeLibraryQueue?.running ? 0 : await requeueStale(db, 0);
  if (requeued) console.info(JSON.stringify({ event: "library.requeued", items: requeued }));
  library.schedule();
}

export { libraryEnvironment } from "./config";
export { receiveUpload, cleanFileName, UploadRefused } from "./files";
