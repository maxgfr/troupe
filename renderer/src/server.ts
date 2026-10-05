import { randomUUID } from "node:crypto";
import { createReadStream, mkdirSync, statSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";

import type { Speak, VoicePools } from "../../src/modules/scene";
import { renderVideo } from "./render";
import { BadRequest, parseJobBody, type RenderRequest } from "./request";

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
  // Where finished MP4s are kept.
  outDir: string;
  token?: string;
  log?: (message: string) => void;
}

interface Job {
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number;
  error?: string;
}

const MAX_BODY_BYTES = 1024 * 1024;
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
        Object.assign(job, { status: "succeeded", progress: 1 });
        log(`Rendered ${id} (${name}): ${request.lines.length} lines, ${durationS.toFixed(2)} s of video, in ${((Date.now() - started) / 1000).toFixed(1)} s`);
      } catch (error) {
        Object.assign(job, { status: "failed", error: (error as Error).message || "The render failed." });
        log(`Render ${id} (${name}) failed: ${job.error}`);
      }
    });
  }

  return createServer((req, res) => {
    if (options.token && req.headers.authorization !== `Bearer ${options.token}`) return send(res, 401, { error: "unauthorized" });
    const url = new URL(req.url ?? "/", "http://localhost");
    let path = url.pathname;
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
}
