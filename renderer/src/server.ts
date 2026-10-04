import { randomUUID } from "node:crypto";
import { createReadStream, mkdirSync, statSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";

import type { Speak } from "./audio";
import { renderVideo } from "./render";
import { BadRequest, parseJobBody, type RenderRequest } from "./request";

// Troupe's HTTP contract v1 (docs/LOCAL-MODELS.md), the same routes as
// examples/http-model/server.mjs. Jobs render one at a time: voicing and
// encoding each use the whole CPU.

export interface RendererOptions {
  speak: Speak;
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

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export function createRendererServer(options: RendererOptions): Server {
  mkdirSync(options.outDir, { recursive: true });
  const log = options.log ?? (() => {});
  const jobs = new Map<string, Job>();
  let queue = Promise.resolve();

  function enqueue(id: string, request: RenderRequest) {
    const job = jobs.get(id)!;
    queue = queue.then(async () => {
      job.status = "running";
      const started = Date.now();
      try {
        const durationS = await renderVideo(request, join(options.outDir, `${id}.mp4`), { speak: options.speak, onProgress: (p) => (job.progress = Math.min(0.99, p)) });
        Object.assign(job, { status: "succeeded", progress: 1 });
        log(`Rendered ${id}: ${request.lines.length} lines, ${durationS.toFixed(2)} s of video, in ${((Date.now() - started) / 1000).toFixed(1)} s`);
      } catch (error) {
        Object.assign(job, { status: "failed", error: (error as Error).message || "The render failed." });
        log(`Render ${id} failed: ${job.error}`);
      }
    });
  }

  return createServer((req, res) => {
    if (options.token && req.headers.authorization !== `Bearer ${options.token}`) return send(res, 401, { error: "unauthorized" });
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true, contract: 1 });
    if (req.method === "POST" && url.pathname === "/jobs") {
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
          request = parseJobBody(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (error) {
          return send(res, 400, { error: error instanceof BadRequest ? error.message : "invalid JSON" });
        }
        const id = randomUUID();
        jobs.set(id, { status: "queued", progress: 0 });
        enqueue(id, request);
        send(res, 200, { id });
      });
      return;
    }
    const job = /^\/jobs\/([0-9a-f-]+)$/.exec(url.pathname);
    if (req.method === "GET" && job) {
      const state = jobs.get(job[1]!);
      if (!state) return send(res, 404, { error: "unknown job" });
      return send(res, 200, { ...state, ...(state.status === "succeeded" ? { video_url: `/files/${job[1]}.mp4` } : {}) });
    }
    const file = /^\/files\/([0-9a-f-]+\.mp4)$/.exec(url.pathname);
    if (req.method === "GET" && file) {
      const path = join(options.outDir, file[1]!);
      try {
        res.writeHead(200, { "content-type": "video/mp4", "content-length": statSync(path).size });
        return createReadStream(path).pipe(res);
      } catch {
        return send(res, 404, { error: "not found" });
      }
    }
    send(res, 404, { error: "not found" });
  });
}
