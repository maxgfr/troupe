import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sizeFor } from "~/modules/models/geometry";
import { createHttpEndpointAdapter, type HttpEndpointModel } from "./http-endpoint";

// Contract test for examples/http-model/server.mjs: the documented starting
// point for a self-hosted model must keep speaking contract v1 to Troupe's
// own HTTP endpoint adapter. Needs ffmpeg/ffprobe on the PATH (CI installs it).

const run = promisify(execFile);
const TOKEN = "example-secret";
const caps = {
  aspectRatios: ["9:16", "16:9", "1:1"],
  resolutions: ["480p", "720p"],
  durationsS: [2, 4],
  audio: "optional" as const,
  dialogueLanguages: null,
};

let server: ChildProcess | undefined;
let baseUrl = "";
let scratch = "";

// PORT=0 lets the OS pick a free port; the server prints the one it got.
function startExampleServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["examples/http-model/server.mjs"], {
      env: { ...process.env, PORT: "0", HOST: "127.0.0.1", TOKEN },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server = child;
    let output = "";
    const timer = setTimeout(() => reject(new Error(`The example server did not start: ${output}`)), 10_000);
    child.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const url = /on (http:\/\/127\.0\.0\.1:(\d+))/.exec(output);
      if (url && url[2] !== "0") {
        clearTimeout(timer);
        resolve(url[1]!);
      }
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`The example server exited with ${code}: ${output}`));
    });
  });
}

function model(patch: Partial<HttpEndpointModel> = {}): HttpEndpointModel {
  return { modelKey: "local-example", label: "Example", baseUrl, token: TOKEN, capabilities: caps, fps: 24, ...patch };
}

async function renderThroughTroupe(request: {
  aspectRatio: string;
  resolution: string;
  durationS: number;
  audio: boolean;
}) {
  const adapter = createHttpEndpointAdapter({ model: model() });
  const { providerJobId } = await adapter.createJob({ prompt: "A presenter says hello.", ...request });
  for (let attempt = 0; attempt < 100; attempt++) {
    const job = await adapter.getJob!(providerJobId);
    if (job.kind === "completed") {
      if (!job.outputUrl) throw new Error("The job completed without a video URL.");
      return Buffer.from(await adapter.downloadResult!(job.outputUrl));
    }
    if (job.kind === "failed") throw new Error(`The example server failed the job: ${job.detail}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("The example server never finished the job.");
}

async function probe(bytes: Buffer, name: string) {
  const file = join(scratch, name);
  await writeFile(file, bytes);
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,codec_name,width,height:format=duration",
    "-of",
    "json",
    file,
  ]);
  return JSON.parse(stdout) as {
    streams: { codec_type: string; codec_name: string; width?: number; height?: number }[];
    format: { duration: string };
  };
}

describe("examples/http-model/server.mjs (contract v1)", () => {
  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "troupe-example-contract-"));
    baseUrl = await startExampleServer();
  });
  afterAll(async () => {
    server?.removeAllListeners("exit");
    server?.kill();
    if (scratch) await rm(scratch, { recursive: true, force: true });
  });

  it("passes Troupe's connection check with its token and refuses requests without it", async () => {
    expect(await createHttpEndpointAdapter({ model: model() }).testConnection!()).toMatchObject({
      ok: true,
      message: "Example is reachable and speaks contract 1.",
      pollEveryS: 1,
    });
    const anonymous = await createHttpEndpointAdapter({ model: model({ token: undefined }) }).testConnection!();
    expect(anonymous).toMatchObject({ ok: false, message: expect.stringMatching(/HTTP 401/) });
  });

  it("renders an MP4 of the requested size and length, with audio when asked", async () => {
    const clip = await probe(
      await renderThroughTroupe({ aspectRatio: "9:16", resolution: "720p", durationS: 2, audio: true }),
      "with-audio.mp4",
    );
    expect(clip.streams).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ codec_type: "video", codec_name: "h264", width: 720, height: 1280 }),
        expect.objectContaining({ codec_type: "audio", codec_name: "aac" }),
      ]),
    );
    expect(Number(clip.format.duration)).toBeCloseTo(2, 1);
  });

  it("renders silent video when audio is off", async () => {
    const clip = await probe(
      await renderThroughTroupe({ aspectRatio: "16:9", resolution: "480p", durationS: 2, audio: false }),
      "silent.mp4",
    );
    expect(clip.streams).toEqual([expect.objectContaining({ codec_type: "video", ...sizeFor("16:9", "480p") })]);
  });

  it("answers bad requests and unknown jobs with the documented errors", async () => {
    const auth = { authorization: `Bearer ${TOKEN}` };
    const missing = await fetch(`${baseUrl}/jobs`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ prompt: "x" }),
    });
    expect(missing.status).toBe(400);
    const notJson = await fetch(`${baseUrl}/jobs`, { method: "POST", headers: auth, body: "{" });
    expect(notJson.status).toBe(400);
    const unknown = await fetch(`${baseUrl}/jobs/00000000-0000-0000-0000-000000000000`, { headers: auth });
    expect(unknown.status).toBe(404);
    await expect(
      createHttpEndpointAdapter({ model: model() }).getJob!("00000000-0000-0000-0000-000000000000"),
    ).rejects.toMatchObject({ code: "LOCAL_HTTP" });
  });
});
