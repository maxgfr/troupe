import { spawn } from "node:child_process";
import { once } from "node:events";
import { rm, writeFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";

import { buildScene, drawFrame, voiceFor, type SceneContext } from "../../src/modules/scene";
import { assembleTrack, wavBytes, type Speak, type Speech } from "./audio";
import type { RenderRequest } from "./request";

export interface RenderDeps {
  speak: Speak;
  // Progress in [0, 1].
  onProgress?: (progress: number) => void;
}

// Share of the progress bar spent voicing the lines; drawing takes the rest.
const VOICE_SHARE = 0.3;

// Voices each line, lays the scene out on the measured speech, then streams
// frames drawn on a canvas into ffmpeg with the assembled track: an H.264 +
// AAC MP4 as long as the script.
export async function renderVideo(request: RenderRequest, outFile: string, deps: RenderDeps): Promise<void> {
  const progress = deps.onProgress ?? (() => {});
  const speeches: Speech[] = [];
  if (request.audio) {
    for (const line of request.lines) {
      speeches.push(await deps.speak(line.text, voiceFor(request.actor, line.emotion)));
      progress((VOICE_SHARE * speeches.length) / request.lines.length);
    }
  }
  const scene = buildScene({
    width: request.width,
    height: request.height,
    fps: request.fps,
    actor: request.actor,
    lines: request.lines,
    ...(request.audio ? { speechS: speeches.map((s) => s.samples.length / s.sampleRate) } : {}),
  });

  const wavFile = `${outFile}.wav`;
  if (request.audio) await writeFile(wavFile, wavBytes(assembleTrack(speeches, scene)));
  try {
    const args = ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${scene.width}x${scene.height}`, "-r", String(scene.fps), "-i", "pipe:0"];
    if (request.audio) args.push("-i", wavFile, "-c:a", "aac", "-b:a", "128k");
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outFile);
    const ffmpeg = spawn(process.env.FFMPEG ?? "ffmpeg", args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    ffmpeg.stderr.on("data", (d: Buffer) => (stderr += d));
    const exited = new Promise<void>((resolve, reject) => {
      ffmpeg.on("error", () => reject(new Error("ffmpeg is not installed on the renderer.")));
      ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr.trim().slice(0, 200) || `ffmpeg exited with ${code}.`))));
    });
    // Awaited below; marked handled so an early exit is not reported twice.
    exited.catch(() => {});
    // Writes after ffmpeg is gone fail with EPIPE; `exited` says why.
    ffmpeg.stdin.on("error", () => {});

    const canvas = createCanvas(scene.width, scene.height);
    const context = canvas.getContext("2d");
    // The scene draws through the same 2D interface as in the browser.
    const ctx: SceneContext = context;
    const frames = Math.round(scene.durationS * scene.fps);
    for (let i = 0; i < frames && ffmpeg.exitCode === null; i++) {
      drawFrame(ctx, scene, i / scene.fps);
      const pixels = context.getImageData(0, 0, scene.width, scene.height).data;
      if (!ffmpeg.stdin.write(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength))) {
        await Promise.race([once(ffmpeg.stdin, "drain").catch(() => {}), exited.catch(() => {})]);
      }
      if (i % scene.fps === 0) progress(VOICE_SHARE + ((1 - VOICE_SHARE) * i) / frames);
    }
    ffmpeg.stdin.end();
    await exited;
  } finally {
    await rm(wavFile, { force: true });
  }
}
