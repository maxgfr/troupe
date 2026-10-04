import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compilePrompt, type CreateJobRequest } from "~/modules/generation/server/adapter";
import { createHttpEndpointAdapter, type HttpEndpointModel } from "~/modules/generation/server/adapters/http-endpoint";
import { sizeFor } from "~/modules/models/geometry";
import { buildScene, paletteFor, voiceFor } from "../../src/modules/scene";
import type { Speak } from "./audio";
import { registerSceneFonts } from "./fonts";
import { createRendererServer } from "./server";

// Contract test for the local renderer: Troupe's own HTTP endpoint adapter
// drives it like any contract v1 model. A tone stands in for Kokoro so the
// suite never downloads voice weights. Needs ffmpeg/ffprobe on the PATH.

const run = promisify(execFile);
const TOKEN = "renderer-secret";
const caps = { aspectRatios: ["9:16", "16:9", "1:1"], resolutions: ["480p", "720p"], durationsS: [4, 6, 8], audio: "optional" as const, dialogueLanguages: ["en"] };
const RATE = 24000;

// A quiet tone as long as the line would take to say at 3 words a second.
const tone: Speak = async (text, voice) => {
  const seconds = text.split(/\s+/).filter(Boolean).length / 3 / voice.speed;
  const samples = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < samples.length; i++) samples[i] = 0.1 * Math.sin((2 * Math.PI * 220 * i) / RATE);
  return { samples, sampleRate: RATE };
};

const actor = { id: "6f1c0e8a-2b7d-4c1e-9a53-0d6e2f4b8c11", name: "Léa Martin", gender: "female" as const, ageRange: "18-24", voiceProfile: "warm and enthusiastic, mid-tempo" };
const lines = [
  { role: "hook" as const, text: "This ended my search.", emotion: "excited" as const },
  { role: "cta" as const, text: "Grab yours today.", emotion: "calm" as const },
];

let scratch = "";
const servers: Server[] = [];

async function start(speak: Speak): Promise<string> {
  const server = createRendererServer({ speak, outDir: scratch, token: TOKEN });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function model(baseUrl: string, patch: Partial<HttpEndpointModel> = {}): HttpEndpointModel {
  return { modelKey: "local-renderer", label: "Renderer", baseUrl, token: TOKEN, capabilities: caps, fps: 24, ...patch };
}

async function renderThroughTroupe(baseUrl: string, request: CreateJobRequest) {
  const adapter = createHttpEndpointAdapter({ model: model(baseUrl) });
  const { providerJobId } = await adapter.createJob(request);
  for (let attempt = 0; attempt < 300; attempt++) {
    const job = await adapter.getJob!(providerJobId);
    if (job.kind === "completed") {
      if (!job.outputUrl) throw new Error("The job completed without a video URL.");
      return Buffer.from(await adapter.downloadResult!(job.outputUrl));
    }
    if (job.kind === "failed") throw new Error(`The renderer failed the job: ${job.detail}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("The renderer never finished the job.");
}

async function save(bytes: Buffer, name: string) {
  const file = join(scratch, name);
  await writeFile(file, bytes);
  return file;
}

async function probe(file: string) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height:format=duration", "-of", "json", file]);
  return JSON.parse(stdout) as { streams: { codec_type: string; codec_name: string; width?: number; height?: number }[]; format: { duration: string } };
}

// One RGB pixel of the frame at `seconds`.
async function pixel(file: string, seconds: number, x: number, y: number) {
  const { stdout } = await run("ffmpeg", ["-v", "error", "-ss", String(seconds), "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  const { width } = (await probe(file)).streams.find((s) => s.codec_type === "video")!;
  const at = (Math.round(y) * width! + Math.round(x)) * 3;
  return [stdout[at]!, stdout[at + 1]!, stdout[at + 2]!];
}

const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

describe("renderer (contract v1)", () => {
  let baseUrl = "";
  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "troupe-renderer-contract-"));
    registerSceneFonts();
    baseUrl = await start(tone);
  });
  afterAll(async () => {
    for (const server of servers) server.close();
    if (scratch) await rm(scratch, { recursive: true, force: true });
  });

  it("passes Troupe's connection check with its token and refuses requests without it", async () => {
    // It renders in seconds, so it asks to be polled every second.
    expect(await createHttpEndpointAdapter({ model: model(baseUrl) }).testConnection!()).toEqual({
      ok: true, message: "Renderer is reachable and speaks contract 1.", details: ["It asks Troupe to check on renders every 1 s."], pollEveryS: 1,
    });
    const anonymous = await createHttpEndpointAdapter({ model: model(baseUrl, { token: undefined }) }).testConnection!();
    expect(anonymous).toMatchObject({ ok: false, message: expect.stringMatching(/HTTP 401/) });
  });

  it("voices the script into an MP4 as long as the script, with the actor card drawn", async () => {
    const prompt = compilePrompt({ lines, voiceProfile: actor.voiceProfile, language: "en" });
    const file = await save(await renderThroughTroupe(baseUrl, { prompt, aspectRatio: "9:16", resolution: "720p", durationS: 6, audio: true, script: { lines, actor, language: "en" } }), "script.mp4");
    const clip = await probe(file);
    expect(clip.streams).toEqual(expect.arrayContaining([
      expect.objectContaining({ codec_type: "video", codec_name: "h264", width: 720, height: 1280 }),
      expect.objectContaining({ codec_type: "audio", codec_name: "aac" }),
    ]));
    // Each line lasts as long as its voice, at the emotion's speed.
    const speechS = await Promise.all(lines.map(async (l) => (await tone(l.text, voiceFor(actor, l.emotion))).samples.length / RATE));
    const scene = buildScene({ width: 720, height: 1280, actor, lines, speechS });
    expect(Number(clip.format.duration)).toBeCloseTo(scene.durationS, 1);

    const { cx, cy, r } = scene.layout.portrait;
    const disc = await pixel(file, 0.1, cx - r / 2, cy - r / 2);
    for (const [i, channel] of rgb(paletteFor(actor.id).portrait).entries()) expect(Math.abs(disc[i]! - channel)).toBeLessThanOrEqual(12);
  });

  it("falls back to the dialogue in the prompt when the job has no script", async () => {
    const prompt = compilePrompt({ lines, voiceProfile: actor.voiceProfile, language: "en" });
    const clip = await probe(await save(await renderThroughTroupe(baseUrl, { prompt, aspectRatio: "1:1", resolution: "480p", durationS: 4, audio: true }), "prompt.mp4"));
    expect(clip.streams.map((s) => s.codec_type).sort()).toEqual(["audio", "video"]);
    expect(Number(clip.format.duration)).toBeGreaterThan(2);
  });

  it("renders silent video at the requested size when audio is off", async () => {
    const clip = await probe(await save(await renderThroughTroupe(baseUrl, { prompt: "A presenter says hello.", aspectRatio: "16:9", resolution: "480p", durationS: 4, audio: false, script: { lines, actor, language: "en" } }), "silent.mp4"));
    expect(clip.streams).toEqual([expect.objectContaining({ codec_type: "video", ...sizeFor("16:9", "480p") })]);
    // Without a voice, lines take their estimated length (2.5 words a second).
    expect(Number(clip.format.duration)).toBeCloseTo(buildScene({ ...sizeFor("16:9", "480p"), actor, lines }).durationS, 1);
  });

  it("answers bad requests and unknown jobs with the documented errors", async () => {
    const auth = { authorization: `Bearer ${TOKEN}` };
    const missing = await fetch(`${baseUrl}/jobs`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ prompt: "x" }) });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "prompt, width, height and duration_s are required" });
    const notJson = await fetch(`${baseUrl}/jobs`, { method: "POST", headers: auth, body: "{" });
    expect(notJson.status).toBe(400);
    const tooBig = await fetch(`${baseUrl}/jobs`, { method: "POST", headers: auth, body: "x".repeat(2_000_000) });
    expect(tooBig.status).toBe(413);
    const unknown = await fetch(`${baseUrl}/jobs/00000000-0000-0000-0000-000000000000`, { headers: auth });
    expect(unknown.status).toBe(404);
    await expect(createHttpEndpointAdapter({ model: model(baseUrl) }).getJob!("00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({ code: "LOCAL_HTTP" });
  });

  it("reports a voice failure as a failed job with a readable error", async () => {
    const broken = await start(async () => {
      throw new Error("Could not load the Kokoro voices.");
    });
    await expect(renderThroughTroupe(broken, { prompt: "x", aspectRatio: "9:16", resolution: "480p", durationS: 4, audio: true, script: { lines, actor, language: "en" } }))
      .rejects.toThrow("The renderer failed the job: Renderer reported: Could not load the Kokoro voices.");
  });
});
