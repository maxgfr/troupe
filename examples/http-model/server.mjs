#!/usr/bin/env node
// A minimal video model server that speaks Troupe's HTTP contract v1
// (docs/LOCAL-MODELS.md). It does not generate anything clever: it renders
// an ffmpeg test pattern of the requested size and length (with a tone when
// audio is requested) so you can check a Troupe setup end to end, then
// replace renderClip() with a call to your own model.
//
//   PORT=8077 TOKEN=optional-secret node examples/http-model/server.mjs
//
// Requires ffmpeg on the PATH. No other dependency.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.PORT ?? 8077);
const HOST = process.env.HOST ?? "0.0.0.0";
const TOKEN = process.env.TOKEN ?? "";
const OUT = join(tmpdir(), "troupe-example-model");
mkdirSync(OUT, { recursive: true });

/** @type {Map<string, { status: "queued" | "running" | "succeeded" | "failed", progress: number, error?: string }>} */
const jobs = new Map();

function renderClip(id, req) {
  const job = jobs.get(id);
  job.status = "running";
  const size = `${req.width}x${req.height}`;
  const args = ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `testsrc2=size=${size}:rate=${req.fps ?? 24}:duration=${req.duration_s}`];
  if (req.audio) args.push("-f", "lavfi", "-i", `sine=frequency=440:duration=${req.duration_s}`, "-c:a", "aac");
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-shortest", join(OUT, `${id}.mp4`));
  const ffmpeg = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  ffmpeg.stderr.on("data", (d) => (stderr += d));
  ffmpeg.on("error", () => Object.assign(job, { status: "failed", error: "ffmpeg is not installed on the model server." }));
  ffmpeg.on("close", (code) => Object.assign(job, code === 0 ? { status: "succeeded", progress: 1 } : { status: "failed", error: stderr.slice(0, 200) || `ffmpeg exited with ${code}` }));
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: "unauthorized" });
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true, contract: 1 });
  if (req.method === "POST" && url.pathname === "/jobs") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let input;
      try {
        input = JSON.parse(body);
      } catch {
        return send(res, 400, { error: "invalid JSON" });
      }
      if (!input.prompt || !input.width || !input.height || !input.duration_s) return send(res, 400, { error: "prompt, width, height and duration_s are required" });
      const id = randomUUID();
      jobs.set(id, { status: "queued", progress: 0 });
      setImmediate(() => renderClip(id, input));
      send(res, 200, { id });
    });
    return;
  }
  const job = /^\/jobs\/([0-9a-f-]+)$/.exec(url.pathname);
  if (req.method === "GET" && job) {
    const state = jobs.get(job[1]);
    if (!state) return send(res, 404, { error: "unknown job" });
    return send(res, 200, { ...state, ...(state.status === "succeeded" ? { video_url: `/files/${job[1]}.mp4` } : {}) });
  }
  const file = /^\/files\/([0-9a-f-]+\.mp4)$/.exec(url.pathname);
  if (req.method === "GET" && file) {
    const path = join(OUT, file[1]);
    try {
      res.writeHead(200, { "content-type": "video/mp4", "content-length": statSync(path).size });
      return createReadStream(path).pipe(res);
    } catch {
      return send(res, 404, { error: "not found" });
    }
  }
  send(res, 404, { error: "not found" });
}).listen(PORT, HOST, () => console.log(`Example model server on http://${HOST}:${PORT} (contract v1)`));
