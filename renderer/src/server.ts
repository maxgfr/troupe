import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";

import type { Speak, VoicePools } from "../../src/modules/scene";
import { renderVideo } from "./render";
import { BadRequest, parseJobBody, type RenderRequest } from "./request";
import type { WhisperResult } from "./whisper";

// Troupe's HTTP contract v1 (docs/LOCAL-MODELS.md), the same routes as
// examples/http-model/server.mjs. The fast mode answers at the root; the
// opt-in AI video mode answers the same routes under /ltx, so Troupe adds it
// as a second model with the address http://host:port/ltx. Jobs from both
// render one at a time: each takes the whole CPU or GPU.

// A way to render a job: resolves with the video's length in seconds.
export interface RenderMode {
  render(request: RenderRequest, outFile: string, onProgress: (progress: number) => void): Promise<number>;
  // How often Troupe should ask about a job, sent in /health.
  pollEveryS: number;
  // Why the mode cannot render right now, or null. /health answers 503
  // with it.
  ready?: () => string | null;
}

export interface RendererOptions {
  speak: Speak;
  // Kokoro voices to cast actors from (default: the scene module's).
  voices?: VoicePools;
  // Where the actors' pictures are (default: the checked-in cast).
  portraitsDir?: string;
  // The AI video mode, served under /ltx when set.
  ltx?: RenderMode;
  // Transcription for the studio's inspiration library, at /transcribe when set.
  whisper?: TranscribeMode;
  // Where finished MP4s are kept.
  outDir: string;
  // How long a finished job and its MP4 are kept, in seconds; 0 keeps them
  // all (default: a day). Troupe downloads a video as soon as it is done.
  keepRendersS?: number;
  token?: string;
  log?: (message: string) => void;
}

export interface TranscribeMode {
  model: string;
  maxBytes: number;
  ready(): string | null;
  transcribe(file: string): Promise<WhisperResult>;
}

export const WHISPER_OFF = "Transcription is off on this renderer. Start it with WHISPER_ENABLED=1 after pnpm renderer:whisper:setup (docs/LIBRARY.md); the Docker image has it on.";

interface Job {
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number;
  error?: string;
  // When it succeeded or failed (Date.now()).
  finishedAt?: number;
}

const MAX_BODY_BYTES = 1024 * 1024;
export const KEEP_RENDERS_S = 24 * 3600;
const VIDEO_FILE = /^([0-9a-f-]+)\.mp4$/;
export const LTX_PREFIX = "/ltx";
export const LTX_OFF = "The AI video mode is off on this renderer. Start it with pnpm renderer:ltx (see docs/LOCAL-MODELS.md).";

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export function createRendererServer(options: RendererOptions): Server {
  mkdirSync(options.outDir, { recursive: true });
  const log = options.log ?? (() => {});
  const jobs = new Map<string, Job>();
  let queue = Promise.resolve();
  const fast: RenderMode = {
    render: (request, outFile, onProgress) => renderVideo(request, outFile, { speak: options.speak, voices: options.voices, onProgress, portraitsDir: options.portraitsDir, log }),
    // A render takes seconds: ask Troupe to check every second.
    pollEveryS: 1,
  };

  function enqueue(id: string, request: RenderRequest, mode: RenderMode, name: string) {
    const job = jobs.get(id)!;
    queue = queue.then(async () => {
      job.status = "running";
      const started = Date.now();
      try {
        const durationS = await mode.render(request, join(options.outDir, `${id}.mp4`), (p) => (job.progress = Math.min(0.99, p)));
        Object.assign(job, { status: "succeeded", progress: 1, finishedAt: Date.now() });
        log(`Rendered ${id} (${name}): ${request.lines.length} lines, ${durationS.toFixed(2)} s of video, in ${((Date.now() - started) / 1000).toFixed(1)} s`);
      } catch (error) {
        Object.assign(job, { status: "failed", error: (error as Error).message || "The render failed.", finishedAt: Date.now() });
        log(`Render ${id} (${name}) failed: ${job.error}`);
      }
    });
  }

  // Deletes the MP4s of jobs finished more than keepRendersS ago, then forgets
  // the jobs, so a job reported gone never has its video still served. Then
  // deletes the MP4s no job it remembers owns once they are that old: any
  // left by an earlier run.
  const keepS = options.keepRendersS ?? KEEP_RENDERS_S;
  async function sweep() {
    const cutoff = Date.now() - keepS * 1000;
    for (const [id, job] of jobs) {
      if (job.finishedAt === undefined || job.finishedAt >= cutoff) continue;
      await rm(join(options.outDir, `${id}.mp4`), { force: true });
      jobs.delete(id);
    }
    for (const name of await readdir(options.outDir)) {
      const id = VIDEO_FILE.exec(name)?.[1];
      if (!id || jobs.has(id)) continue;
      const file = join(options.outDir, name);
      if ((await stat(file)).mtimeMs < cutoff) await rm(file, { force: true });
    }
  }
  let sweeping: NodeJS.Timeout | undefined;
  if (keepS > 0) {
    const run = () => void sweep().catch((error: Error) => log(`Could not clean up old renders: ${error.message}`));
    run();
    sweeping = setInterval(run, Math.min(Math.max(100, (keepS * 1000) / 4), 3600_000));
    sweeping.unref();
  }

  // Transcriptions run one at a time too, apart from the renders.
  let transcriptions = Promise.resolve();
  function transcribe(req: import("node:http").IncomingMessage, res: ServerResponse, whisper: TranscribeMode) {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > whisper.maxBytes) {
      req.resume();
      return send(res, 413, { error: `The sound is larger than ${Math.round(whisper.maxBytes / 1024 / 1024)} MB (WHISPER_MAX_MB).` });
    }
    const dir = mkdtempSync(join(tmpdir(), "troupe-whisper-"));
    const file = join(dir, "audio");
    const out = createWriteStream(file, { mode: 0o600 });
    let received = 0;
    let refused = false;
    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > whisper.maxBytes && !refused) {
        refused = true;
        out.destroy();
        req.resume();
      }
    });
    req.pipe(out);
    req.on("end", () => {
      const done = () => rmSync(dir, { recursive: true, force: true });
      if (refused) {
        done();
        return send(res, 413, { error: `The sound is larger than ${Math.round(whisper.maxBytes / 1024 / 1024)} MB (WHISPER_MAX_MB).` });
      }
      out.on("close", () => {
        if (received === 0) {
          done();
          return send(res, 400, { error: "Send the sound as the request body." });
        }
        transcriptions = transcriptions.then(async () => {
          const started = Date.now();
          try {
            const result = await whisper.transcribe(file);
            log(`Transcribed ${(received / 1024).toFixed(0)} KB of sound (${result.language ?? "?"}, ${result.segments.length} segments) in ${((Date.now() - started) / 1000).toFixed(1)} s`);
            send(res, 200, result);
          } catch (error) {
            log(`Transcription failed: ${(error as Error).message}`);
            send(res, 500, { error: (error as Error).message || "The transcription failed." });
          } finally {
            done();
          }
        });
      });
    });
  }

  const server = createServer((req, res) => {
    if (options.token && req.headers.authorization !== `Bearer ${options.token}`) return send(res, 401, { error: "unauthorized" });
    const url = new URL(req.url ?? "/", "http://localhost");
    let path = url.pathname;
    if (path === "/transcribe/health" && req.method === "GET") {
      if (!options.whisper) return send(res, 503, { ok: false, error: WHISPER_OFF });
      const unready = options.whisper.ready();
      return unready ? send(res, 503, { ok: false, error: unready }) : send(res, 200, { ok: true, model: `faster-whisper ${options.whisper.model}` });
    }
    if (path === "/transcribe" && req.method === "POST") {
      if (!options.whisper) {
        req.resume();
        return send(res, 503, { error: WHISPER_OFF });
      }
      const unready = options.whisper.ready();
      if (unready) {
        req.resume();
        return send(res, 503, { error: unready });
      }
      return transcribe(req, res, options.whisper);
    }
    let mode = fast;
    let name = "fast";
    if (path === LTX_PREFIX || path.startsWith(`${LTX_PREFIX}/`)) {
      if (!options.ltx) return send(res, 503, { ok: false, error: LTX_OFF });
      path = path.slice(LTX_PREFIX.length);
      mode = options.ltx;
      name = "ltx";
    }
    if (req.method === "GET" && path === "/health") {
      const unready = mode.ready?.();
      if (unready) return send(res, 503, { ok: false, error: unready });
      return send(res, 200, { ok: true, contract: 1, poll_every_s: mode.pollEveryS });
    }
    if (req.method === "POST" && path === "/jobs") {
      const chunks: Buffer[] = [];
      let received = 0;
      req.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received <= MAX_BODY_BYTES) chunks.push(chunk);
      });
      req.on("end", () => {
        if (received > MAX_BODY_BYTES) return send(res, 413, { error: "The job body is larger than 1 MB." });
        let request: RenderRequest;
        try {
          request = parseJobBody(JSON.parse(Buffer.concat(chunks).toString("utf8")), log);
        } catch (error) {
          return send(res, 400, { error: error instanceof BadRequest ? error.message : "invalid JSON" });
        }
        const id = randomUUID();
        jobs.set(id, { status: "queued", progress: 0 });
        enqueue(id, request, mode, name);
        send(res, 200, { id });
      });
      return;
    }
    const job = /^\/jobs\/([0-9a-f-]+)$/.exec(path);
    if (req.method === "GET" && job) {
      const state = jobs.get(job[1]!);
      if (!state) return send(res, 404, { error: "unknown job" });
      // Both modes draw the script's captions into the picture.
      return send(res, 200, { ...state, ...(state.status === "succeeded" ? { video_url: `/files/${job[1]}.mp4`, captions: "burned" } : {}) });
    }
    const file = /^\/files\/([0-9a-f-]+\.mp4)$/.exec(path);
    if (req.method === "GET" && file) {
      const filePath = join(options.outDir, file[1]!);
      try {
        res.writeHead(200, { "content-type": "video/mp4", "content-length": statSync(filePath).size });
        return createReadStream(filePath).pipe(res);
      } catch {
        return send(res, 404, { error: "not found" });
      }
    }
    send(res, 404, { error: "not found" });
  });
  server.on("close", () => clearInterval(sweeping));
  return server;
}
