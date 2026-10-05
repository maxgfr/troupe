import { rm } from "node:fs/promises";

import { drawFrame } from "../../src/modules/scene";
import { generateClip, generateJob, type LtxSettings, type Upscaler, type Loop } from "./ltx";
import { AAC_OUTPUT, encodeFrames, framesInput, H264_OUTPUT, voiceScene, writeVoiceTrack, type RenderDeps } from "./render";
import type { RenderRequest } from "./request";

export interface LtxRenderDeps extends RenderDeps {
  settings: LtxSettings;
  log?: (message: string) => void;
}

// Shares of the progress bar: voicing, generating the clip, composing.
const VOICE_SHARE = 0.05;
const GENERATE_SHARE = 0.85;

// The ffmpeg filter that turns the generated clip (input 1) into the
// background: repeated to cover the script, retimed, upscaled and cropped to
// the requested frame, with the captions (input 0, transparent) on top.
export function composeFilter(options: { width: number; height: number; fps: number; clipFps: number; upscale: Upscaler; loop: Loop }): string {
  const { width: w, height: h, fps, clipFps, upscale, loop } = options;
  const repeat = loop === "pingpong" ? "split[fwd][back];[back]reverse[rev];[fwd][rev]concat=n=2:v=1:a=0," : "";
  return [
    `[1:v]${repeat}loop=loop=-1:size=32767,setpts=N/(${clipFps}*TB),fps=${fps},`,
    `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=${upscale},crop=${w}:${h},setsar=1[bg];`,
    `[bg][0:v]overlay=shortest=1:format=auto,format=yuv420p[v]`,
  ].join("");
}

// The AI video mode: voices the lines like the fast mode, has LTX-Video
// generate a short clip of the actor, then lays the captions over it
// (upscaled to the requested size and repeated to the script's length) and
// adds the voice. Returns the video's length in seconds.
export async function renderLtxVideo(request: RenderRequest, outFile: string, deps: LtxRenderDeps): Promise<number> {
  const progress = deps.onProgress ?? (() => {});
  const { settings } = deps;
  const { scene, speeches } = await voiceScene(request, deps, (share) => progress(VOICE_SHARE * share));

  const clipFile = `${outFile}.ltx.mp4`;
  const wavFile = `${outFile}.wav`;
  try {
    const job = generateJob(settings, request, clipFile);
    deps.log?.(`LTX: ${job.width}x${job.height}, ${job.num_frames} frames, seed ${job.seed}`);
    const report = await generateClip(settings, job, (p) => progress(VOICE_SHARE + GENERATE_SHARE * p));
    deps.log?.(`LTX clip ready in ${report.seconds} s on ${report.device ?? "?"} (peak memory ${report.peak_rss_mb} MB)`);

    const voiced = await writeVoiceTrack(wavFile, speeches, scene);
    const args = ["-y", "-loglevel", "error", ...framesInput(scene), "-i", clipFile];
    if (voiced) args.push("-i", wavFile);
    args.push("-filter_complex", composeFilter({ width: scene.width, height: scene.height, fps: scene.fps, clipFps: settings.frameRate, upscale: settings.upscale, loop: settings.loop }));
    args.push("-map", "[v]");
    if (voiced) args.push("-map", "2:a", ...AAC_OUTPUT);
    args.push(...H264_OUTPUT, outFile);
    const start = VOICE_SHARE + GENERATE_SHARE;
    await encodeFrames(args, scene, (ctx, t) => drawFrame(ctx, scene, t, { captionsOnly: true }), (share) => progress(start + (1 - start) * share));
    return scene.durationS;
  } finally {
    await rm(clipFile, { force: true });
    await rm(wavFile, { force: true });
  }
}
