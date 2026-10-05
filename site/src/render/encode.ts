import {
  AudioSample, AudioSampleSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output,
  QUALITY_HIGH, QUALITY_LOW, QUALITY_MEDIUM, QUALITY_VERY_HIGH, QUALITY_VERY_LOW,
  canEncodeVideo, getFirstEncodableAudioCodec, type AudioCodec, type Quality,
} from "mediabunny";

import { drawFrame, type Scene, type SceneContext, type Speech } from "~/modules/scene";
import type { VideoQuality } from "./config";
import { encoderDelayS } from "./encoder-delay";
import { RENDER_CONFIG } from "./env";

// Draws every frame of a scene on an OffscreenCanvas and encodes it with
// WebCodecs, H.264 video and AAC audio (Opus where the browser has no AAC
// encoder, as on Chromium for Linux), muxed into an MP4 by mediabunny.
// Bitrates, key frames and the audio codecs come from VITE_RENDER_*.

// AAC and Opus encoders both take 48 kHz; Kokoro speaks at 24 kHz.
const AUDIO_RATE = 48_000;
const QUALITY: Record<VideoQuality, Quality> = {
  "very-low": QUALITY_VERY_LOW, low: QUALITY_LOW, medium: QUALITY_MEDIUM, high: QUALITY_HIGH, "very-high": QUALITY_VERY_HIGH,
};
const { audioBitrate, audioCodecs, keyFrameIntervalS, videoBitrate } = RENDER_CONFIG;
const videoBits = typeof videoBitrate === "number" ? videoBitrate : QUALITY[videoBitrate];

export interface Codecs {
  video: "avc";
  audio: AudioCodec;
}

// What this browser can encode at this size, or why it cannot ("it has…").
export async function pickCodecs(width: number, height: number): Promise<Codecs | { problem: string }> {
  if (typeof VideoEncoder === "undefined" || typeof AudioEncoder === "undefined") return { problem: "it has no WebCodecs encoder" };
  if (!(await canEncodeVideo("avc", { width, height, bitrate: videoBits }))) return { problem: `it cannot encode ${width}×${height} H.264 video` };
  const audio = await getFirstEncodableAudioCodec(audioCodecs, { numberOfChannels: 1, sampleRate: AUDIO_RATE, bitrate: audioBitrate });
  if (!audio) return { problem: `it cannot encode ${audioCodecs.map((c) => (c === "aac" ? "AAC" : "Opus")).join(" or ")} audio` };
  return { video: "avc", audio };
}

export async function encodeScene(scene: Scene, track: Speech, onFrame: (frame: number, frames: number) => void): Promise<Blob> {
  const codecs = await pickCodecs(scene.width, scene.height);
  if ("problem" in codecs) throw new Error(`This browser cannot render video: ${codecs.problem}.`);

  const canvas = new OffscreenCanvas(scene.width, scene.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot draw on an OffscreenCanvas.");
  // The scene draws through the same 2D interface as in the Node renderer.
  const ctx: SceneContext = context;

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: codecs.video, bitrate: videoBits, keyFrameInterval: keyFrameIntervalS });
  const audio = new AudioSampleSource({ codec: codecs.audio, bitrate: audioBitrate, transform: { sampleRate: AUDIO_RATE } });
  output.addVideoTrack(video, { frameRate: scene.fps });
  output.addAudioTrack(audio);

  try {
    // Stamped early by the encoder's own delay (encoder-delay.ts): the MP4's
    // edit list then trims the encoder's leading silence, and the voice starts
    // with the picture.
    const delayS = await encoderDelayS(codecs.audio, audioBitrate);
    await output.start();
    const sample = new AudioSample({ data: track.samples, format: "f32", numberOfChannels: 1, sampleRate: track.sampleRate, timestamp: -delayS });
    await audio.add(sample);
    sample.close();
    audio.close();

    const frames = Math.round(scene.durationS * scene.fps);
    for (let i = 0; i < frames; i++) {
      drawFrame(ctx, scene, i / scene.fps);
      await video.add(i / scene.fps, 1 / scene.fps);
      if (i % scene.fps === 0) onFrame(i, frames);
    }
    video.close();
    await output.finalize();
  } catch (error) {
    if (output.state !== "finalized") await output.cancel().catch(() => {});
    throw error;
  }
  const buffer = output.target.buffer;
  if (!buffer) throw new Error("The video encoder produced no file.");
  return new Blob([buffer], { type: "video/mp4" });
}
