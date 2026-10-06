import { spawn } from "node:child_process";
import { once } from "node:events";
import { rm, writeFile } from "node:fs/promises";
import { createCanvas, type Image } from "@napi-rs/canvas";

import {
  assembleTrack,
  buildScene,
  drawFrame,
  portraitShots,
  voiceFor,
  type Scene,
  type SceneContext,
  type Speak,
  type Speech,
  type VoicePools,
} from "../../src/modules/scene";
import { wavBytes } from "./audio";
import { DEFAULT_PORTRAITS_DIR, loadPortraits } from "./portraits";
import type { RenderRequest } from "./request";

export interface RenderDeps {
  speak: Speak;
  voices?: VoicePools;
  // Progress in [0, 1].
  onProgress?: (progress: number) => void;
  // The actors' pictures (portraits.ts; default: the checked-in cast).
  portraitsDir?: string;
  // One hue for every actor's scene (SCENE_HUE); unset: each actor's own.
  sceneHue?: number;
  log?: (message: string) => void;
}

// Share of the progress bar spent voicing the lines; drawing takes the rest.
const VOICE_SHARE = 0.3;

// Voices each line (unless the job is silent) and lays the scene out on the
// measured speech. `onProgress` gets the share of lines voiced, in [0, 1].
export async function voiceScene(
  request: RenderRequest,
  deps: Pick<RenderDeps, "speak" | "voices" | "sceneHue">,
  onProgress: (share: number) => void = () => {},
): Promise<{ scene: Scene; speeches: Speech[] }> {
  const speeches: Speech[] = [];
  if (request.audio) {
    for (const line of request.lines) {
      speeches.push(await deps.speak(line.text, voiceFor(request.actor, line.emotion, deps.voices)));
      onProgress(speeches.length / request.lines.length);
    }
  }
  const scene = buildScene({
    width: request.width,
    height: request.height,
    fps: request.fps,
    actor: request.actor,
    lines: request.lines,
    ...(deps.sceneHue === undefined ? {} : { hue: deps.sceneHue }),
    ...(request.audio ? { speechS: speeches.map((s) => s.samples.length / s.sampleRate) } : {}),
  });
  return { scene, speeches };
}

// The voice track as a WAV file ffmpeg can read, or none for a silent job.
export async function writeVoiceTrack(file: string, speeches: Speech[], scene: Scene): Promise<boolean> {
  if (speeches.length === 0) return false;
  await writeFile(file, wavBytes(assembleTrack(speeches, scene)));
  return true;
}

// Runs ffmpeg with `args`, whose first input must be raw RGBA frames of the
// scene on stdin (`-f rawvideo -pix_fmt rgba -s WxH -r fps -i pipe:0`), and
// streams it every frame `draw` paints. `onProgress` gets the share drawn.
export async function encodeFrames(
  args: string[],
  scene: Scene,
  draw: (ctx: SceneContext<Image>, t: number) => void,
  onProgress: (share: number) => void = () => {},
): Promise<void> {
  const ffmpeg = spawn(process.env.FFMPEG ?? "ffmpeg", args, { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  ffmpeg.stderr.on("data", (d: Buffer) => (stderr += d));
  const exited = new Promise<void>((resolve, reject) => {
    ffmpeg.on("error", () => reject(new Error("ffmpeg is not installed on the renderer.")));
    ffmpeg.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(stderr.trim().slice(0, 200) || `ffmpeg exited with ${code}.`)),
    );
  });
  // Awaited below; marked handled so an early exit is not reported twice.
  exited.catch(() => {});
  // Writes after ffmpeg is gone fail with EPIPE; `exited` says why.
  ffmpeg.stdin.on("error", () => {});

  const canvas = createCanvas(scene.width, scene.height);
  const context = canvas.getContext("2d");
  // The scene draws through the same 2D interface as in the browser.
  const ctx: SceneContext<Image> = context;
  const frames = Math.round(scene.durationS * scene.fps);
  try {
    for (let i = 0; i < frames && ffmpeg.exitCode === null; i++) {
      draw(ctx, i / scene.fps);
      const pixels = context.getImageData(0, 0, scene.width, scene.height).data;
      if (!ffmpeg.stdin.write(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength))) {
        await Promise.race([once(ffmpeg.stdin, "drain").catch(() => {}), exited.catch(() => {})]);
      }
      if (i % scene.fps === 0) onProgress(i / frames);
    }
    ffmpeg.stdin.end();
    await exited;
  } finally {
    // A frame that failed to draw leaves ffmpeg waiting for the next one.
    if (ffmpeg.exitCode === null && ffmpeg.signalCode === null) ffmpeg.kill("SIGKILL");
  }
}

// The raw frames input encodeFrames feeds.
export const framesInput = (scene: Scene) => [
  "-f",
  "rawvideo",
  "-pix_fmt",
  "rgba",
  "-s",
  `${scene.width}x${scene.height}`,
  "-r",
  String(scene.fps),
  "-i",
  "pipe:0",
];
export const H264_OUTPUT = [
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-crf",
  "20",
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
];
export const AAC_OUTPUT = ["-c:a", "aac", "-b:a", "128k"];

// Voices each line, lays the scene out on the measured speech, then streams
// frames drawn on a canvas into ffmpeg with the assembled track: an H.264 +
// AAC MP4 as long as the script, the actor's pictures in the card. Returns
// its length in seconds.
export async function renderVideo(request: RenderRequest, outFile: string, deps: RenderDeps): Promise<number> {
  const progress = deps.onProgress ?? (() => {});
  const { scene, speeches } = await voiceScene(request, deps, (share) => progress(VOICE_SHARE * share));
  const portraits = await loadPortraits(
    deps.portraitsDir ?? DEFAULT_PORTRAITS_DIR,
    request.actor.portraits,
    portraitShots(scene),
    deps.log,
  );
  const wavFile = `${outFile}.wav`;
  try {
    const voiced = await writeVoiceTrack(wavFile, speeches, scene);
    const args = ["-y", "-loglevel", "error", ...framesInput(scene)];
    if (voiced) args.push("-i", wavFile, ...AAC_OUTPUT);
    args.push(...H264_OUTPUT, outFile);
    await encodeFrames(
      args,
      scene,
      (ctx, t) => drawFrame(ctx, scene, t, { portraits }),
      (share) => progress(VOICE_SHARE + (1 - VOICE_SHARE) * share),
    );
    return scene.durationS;
  } finally {
    await rm(wavFile, { force: true });
  }
}
