import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createCanvas } from "@napi-rs/canvas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compilePrompt, type CreateJobRequest } from "~/modules/generation/server/adapter";
import { createHttpEndpointAdapter, type HttpEndpointModel } from "~/modules/generation/server/adapters/http-endpoint";
import { sizeFor } from "~/modules/models/geometry";
import { buildScene, paletteFor, voiceFor } from "../../src/modules/scene";
import type { Speak } from "../../src/modules/scene";
import { registerSceneFonts } from "./fonts";
import { ltxSettingsFromEnv, type LtxSettings } from "./ltx";
import { renderLtxVideo } from "./render-ltx";
import { createRendererServer, LTX_OFF, type RenderMode } from "./server";

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

async function start(speak: Speak, ltx?: RenderMode, portraitsDir?: string): Promise<string> {
  const server = createRendererServer({ speak, outDir: scratch, token: TOKEN, ...(ltx ? { ltx } : {}), ...(portraitsDir ? { portraitsDir } : {}) });
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
      // Every renderer video shows the script's captions in the picture.
      if (job.captions !== "burned") throw new Error("The job did not say its captions are burned in.");
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
    for (const server of servers.splice(0)) server.close();
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

  it("draws the actor's pictures in the card, the line's expression when there is one", async () => {
    // Flat pictures in a portraits folder: the card must show their colors.
    const dir = join(scratch, "cast");
    const flat = async (file: string, color: string) => {
      const canvas = createCanvas(64, 64);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 64, 64);
      await mkdir(join(dir, "lea-01", "v1"), { recursive: true });
      await writeFile(join(dir, "lea-01", "v1", file), canvas.toBuffer("image/webp"));
    };
    await flat("front.webp", "#c08040");
    await flat("excited.webp", "#2060d0");
    const pictured = await start(tone, undefined, dir);
    const portraits = { front: "actors/lea-01/v1/front.webp", excited: "actors/lea-01/v1/excited.webp", calm: "actors/lea-01/v1/calm.webp" };
    const prompt = compilePrompt({ lines, voiceProfile: actor.voiceProfile, language: "en" });
    const file = await save(await renderThroughTroupe(pictured, { prompt, aspectRatio: "9:16", resolution: "720p", durationS: 6, audio: true, script: { lines, actor: { ...actor, portraits }, language: "en" } }), "pictured.mp4");
    const speechS = await Promise.all(lines.map(async (l) => (await tone(l.text, voiceFor(actor, l.emotion))).samples.length / RATE));
    const scene = buildScene({ width: 720, height: 1280, actor, lines, speechS });
    const { cx, cy } = scene.layout.portrait;
    const near = (got: number[], hex: string) => got.every((v, i) => Math.abs(v - rgb(hex)[i]!) <= 16);
    // The first line is excited: its picture.
    expect(near(await pixel(file, 0.1, cx, cy), "#2060d0")).toBe(true);
    // The second is calm, which this actor has no picture for: the front one.
    expect(near(await pixel(file, scene.cues[1]!.endS - 0.05, cx, cy), "#c08040")).toBe(true);
  });

  it("falls back to the dialogue in the prompt when the job has no script", async () => {
    const prompt = compilePrompt({ lines, voiceProfile: actor.voiceProfile, language: "en" });
    const clip = await probe(await save(await renderThroughTroupe(baseUrl, { prompt, aspectRatio: "1:1", resolution: "480p", durationS: 4, audio: true }), "prompt.mp4"));
    expect(clip.streams.map((s) => s.codec_type).sort()).toEqual(["audio", "video"]);
    // The prompt's lines, voiced for the narrator its voice profile keys.
    const narrator = { id: `prompt:${actor.voiceProfile}`, name: "Narrator", voiceProfile: actor.voiceProfile };
    const speechS = await Promise.all(lines.map(async (l) => (await tone(l.text, voiceFor(narrator, l.emotion))).samples.length / RATE));
    expect(Number(clip.format.duration)).toBeCloseTo(buildScene({ ...sizeFor("1:1", "480p"), actor: narrator, lines, speechS }).durationS, 1);
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

  it("says how to turn the AI video mode on when it is off", async () => {
    expect(await createHttpEndpointAdapter({ model: model(`${baseUrl}/ltx`) }).testConnection!()).toEqual({
      ok: false,
      message: `Renderer returned HTTP 503: ${LTX_OFF}`,
    });
  });

  it("forgets finished jobs and deletes their videos after keepRendersS, and old videos left in the folder", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "troupe-renderer-sweep-"));
    try {
      const hourAgo = new Date(Date.now() - 3600_000);
      const orphan = join(outDir, "00000000-0000-0000-0000-000000000001.mp4");
      const notes = join(outDir, "notes.txt");
      for (const file of [orphan, notes]) {
        await writeFile(file, "x");
        await utimes(file, hourAgo, hourAgo);
      }
      const server = createRendererServer({ speak: tone, outDir, keepRendersS: 1.5 });
      servers.push(server);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const body = { prompt: "x", width: 160, height: 160, duration_s: 4, audio: false, script: { language: "en", actor: { id: actor.id, name: actor.name }, lines } };
      const { id } = (await (await fetch(`${origin}/jobs`, { method: "POST", body: JSON.stringify(body) })).json()) as { id: string };
      const status = async () => {
        const res = await fetch(`${origin}/jobs/${id}`);
        return res.status === 404 ? "gone" : ((await res.json()) as { status: string }).status;
      };
      await expect.poll(status, { timeout: 20_000, interval: 100 }).toBe("succeeded");
      const video = join(outDir, `${id}.mp4`);
      expect(existsSync(video)).toBe(true);
      // A job's video goes with the job, whatever the file's date says.
      const hourAhead = new Date(Date.now() + 3600_000);
      await utimes(video, hourAhead, hourAhead);
      // The orphan is older than keepRendersS: swept at once; the rest stays.
      await expect.poll(() => existsSync(orphan), { timeout: 2000 }).toBe(false);
      expect(existsSync(notes)).toBe(true);
      // Once the job is gone, so is its video: never a moment between.
      await expect.poll(status, { timeout: 5000, interval: 100 }).toBe("gone");
      expect(existsSync(video)).toBe(false);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("reports a voice failure as a failed job with a readable error", async () => {
    const broken = await start(async () => {
      throw new Error("Could not load the Kokoro voices.");
    });
    await expect(renderThroughTroupe(broken, { prompt: "x", aspectRatio: "9:16", resolution: "480p", durationS: 4, audio: true, script: { lines, actor, language: "en" } }))
      .rejects.toThrow("The renderer failed the job: Renderer reported: Could not load the Kokoro voices.");
  });
});

// The AI video mode, with a script standing in for LTX-Video: it "generates"
// a small clip of one flat color, which the renderer must upscale, repeat to
// the script's length, caption and voice.
describe("renderer AI video mode (/ltx, contract v1)", () => {
  const FAKE = join(import.meta.dirname, "..", "test", "fake-generate.mjs");
  const CLIP_COLOR = "#2a6fdb";
  let baseUrl = "";
  let failing = "";
  const settings = (patch: Partial<LtxSettings> = {}): LtxSettings => ({
    ...ltxSettingsFromEnv({}, [process.execPath, FAKE, "--color", `0x${CLIP_COLOR.slice(1)}`]),
    resolution: { width: 96, height: 160 },
    frames: 25,
    ...patch,
  });
  const ltxMode = (patch: Partial<LtxSettings> = {}): RenderMode => ({
    render: (request, outFile, onProgress) => renderLtxVideo(request, outFile, { speak: tone, settings: settings(patch), onProgress }),
    pollEveryS: 5,
  });

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "troupe-renderer-ltx-"));
    registerSceneFonts();
    baseUrl = `${await start(tone, ltxMode())}/ltx`;
    failing = `${await start(tone, ltxMode({ command: [process.execPath, FAKE, "--fail", "RuntimeError: MPS backend out of memory"] }))}/ltx`;
  });
  afterAll(async () => {
    for (const server of servers.splice(0)) server.close();
    await rm(scratch, { recursive: true, force: true });
  });

  it("is its own model at /ltx, polled every 5 s, beside the fast mode", async () => {
    expect(await createHttpEndpointAdapter({ model: model(baseUrl) }).testConnection!()).toMatchObject({ ok: true, pollEveryS: 5 });
    const fast = baseUrl.replace(/\/ltx$/, "");
    expect(await createHttpEndpointAdapter({ model: model(fast) }).testConnection!()).toMatchObject({ ok: true, pollEveryS: 1 });
  });

  it("lays the captions and the voice over the generated clip, upscaled and as long as the script", async () => {
    const file = await save(await renderThroughTroupe(baseUrl, { prompt: "x", aspectRatio: "9:16", resolution: "720p", durationS: 6, audio: true, script: { lines, actor, language: "en" } }), "ltx.mp4");
    const clip = await probe(file);
    expect(clip.streams).toEqual(expect.arrayContaining([
      expect.objectContaining({ codec_type: "video", codec_name: "h264", width: 720, height: 1280 }),
      expect.objectContaining({ codec_type: "audio", codec_name: "aac" }),
    ]));
    // The generated clip lasts about a second; the video lasts the script.
    const speechS = await Promise.all(lines.map(async (l) => (await tone(l.text, voiceFor(actor, l.emotion))).samples.length / RATE));
    const scene = buildScene({ width: 720, height: 1280, actor, lines, speechS });
    expect(Number(clip.format.duration)).toBeCloseTo(scene.durationS, 1);

    // Above the captions: the clip itself, upscaled, with no actor card.
    const { cx, cy } = scene.layout.portrait;
    for (const at of [0.2, scene.durationS - 0.2]) {
      const top = await pixel(file, at, cx, cy);
      for (const [i, channel] of rgb(CLIP_COLOR).entries()) expect(Math.abs(top[i]! - channel), `at ${at} s`).toBeLessThanOrEqual(12);
    }
    // Behind the captions, in the lower third: the clip under the shade,
    // darker but not hidden.
    const overlay = scene.layout.overlayCaptions;
    const shaded = await pixel(file, 0.2, 4, overlay.y + overlay.height / 2);
    for (const [i, channel] of rgb(CLIP_COLOR).entries()) {
      expect(shaded[i]!).toBeLessThan(channel);
      expect(shaded[i]!).toBeGreaterThan(channel * 0.3);
    }
  });

  it("crops the clip to other formats, and plays it from the start again when asked", async () => {
    const server = `${await start(tone, ltxMode({ loop: "loop", upscale: "bicubic" }))}/ltx`;
    const clip = await probe(await save(await renderThroughTroupe(server, { prompt: "x", aspectRatio: "16:9", resolution: "480p", durationS: 4, audio: false, script: { lines, actor, language: "en" } }), "ltx-wide.mp4"));
    expect(clip.streams).toEqual([expect.objectContaining({ codec_type: "video", ...sizeFor("16:9", "480p") })]);
    expect(Number(clip.format.duration)).toBeCloseTo(buildScene({ ...sizeFor("16:9", "480p"), actor, lines }).durationS, 1);
  });

  it("tells Test why the mode cannot render yet", async () => {
    const unready = `${await start(tone, { ...ltxMode(), ready: () => "The AI video mode's Python environment is not set up yet." })}/ltx`;
    expect(await createHttpEndpointAdapter({ model: model(unready) }).testConnection!()).toEqual({
      ok: false,
      message: "Renderer returned HTTP 503: The AI video mode's Python environment is not set up yet.",
    });
  });

  it("reports a generation failure as a failed job with the model's error", async () => {
    await expect(renderThroughTroupe(failing, { prompt: "x", aspectRatio: "9:16", resolution: "480p", durationS: 4, audio: true, script: { lines, actor, language: "en" } }))
      .rejects.toThrow("The renderer failed the job: Renderer reported: LTX failed: RuntimeError: MPS backend out of memory");
  });
});
