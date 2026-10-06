// A relative path: site/vite.config.ts loads this file without the ~ alias.
import { KOKORO_VOICES, parseSceneHue, parseVoicePools, type VoicePools } from "../../../src/modules/scene";

// What a fork can change about the in-browser renderer, read from VITE_*
// variables when the site is built (site/.env.example lists them). The build
// checks them with this parser (site/vite.config.ts) and stops on a bad value.

export type KokoroDtype = "fp32" | "fp16" | "q8" | "q4" | "q4f16";
export type VideoQuality = "very-low" | "low" | "medium" | "high" | "very-high";
export type AudioCodecChoice = "aac" | "opus";

export interface RenderConfig {
  // A Kokoro-82M v1.0 ONNX export on the Hugging Face Hub.
  kokoroModel: string;
  // Where the voices run: "auto" uses WebGPU when the browser has it.
  device: "auto" | "webgpu" | "wasm";
  dtype: { webgpu: KokoroDtype; wasm: KokoroDtype };
  voices: VoicePools;
  fps: number;
  // A quality level (scaled to the frame size) or bits per second.
  videoBitrate: VideoQuality | number;
  keyFrameIntervalS: number;
  audioBitrate: number;
  // Tried in order; the first one the browser can encode wins.
  audioCodecs: AudioCodecChoice[];
  // One hue for every actor's card and captions; null: each actor's own.
  sceneHue: number | null;
  // A font file drawn instead of Geist: an https URL or a path under the
  // site's base (a file a fork adds to site/public); null: Geist.
  sceneFontUrl: string | null;
}

export const DEFAULT_RENDER_CONFIG: RenderConfig = {
  kokoroModel: "onnx-community/Kokoro-82M-v1.0-ONNX",
  device: "auto",
  // Full precision on WebGPU and 8-bit on the CPU, as kokoro-js recommends.
  dtype: { webgpu: "fp32", wasm: "q8" },
  voices: KOKORO_VOICES,
  // The Node renderer's rate, so both make the same video.
  fps: 24,
  videoBitrate: "high",
  // A key frame every second keeps seeking quick in a short clip.
  keyFrameIntervalS: 1,
  audioBitrate: 128_000,
  // AAC plays everywhere; Chromium on Linux has no AAC encoder, hence Opus.
  audioCodecs: ["aac", "opus"],
  sceneHue: null,
  sceneFontUrl: null,
};

// Weight files and their sizes in Kokoro-82M-v1.0-ONNX, by dtype.
export const KOKORO_WEIGHTS: Record<KokoroDtype, { file: string; mb: number }> = {
  fp32: { file: "onnx/model.onnx", mb: 326 },
  fp16: { file: "onnx/model_fp16.onnx", mb: 163 },
  q8: { file: "onnx/model_quantized.onnx", mb: 92 },
  q4: { file: "onnx/model_q4.onnx", mb: 305 },
  q4f16: { file: "onnx/model_q4f16.onnx", mb: 155 },
};

const DTYPES = Object.keys(KOKORO_WEIGHTS) as KokoroDtype[];
const QUALITIES: VideoQuality[] = ["very-low", "low", "medium", "high", "very-high"];

type Env = Record<string, string | boolean | undefined>;

export function parseRenderConfig(env: Env): RenderConfig {
  const problems: string[] = [];
  const read = (name: string) => {
    const value = env[name];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
  };
  function oneOf<T extends string>(name: string, options: readonly T[], fallback: T): T {
    const value = read(name);
    if (value === undefined) return fallback;
    if ((options as readonly string[]).includes(value)) return value as T;
    problems.push(`${name} must be one of ${options.join(", ")} (got "${value}").`);
    return fallback;
  }
  function number(name: string, fallback: number, min: number, max: number, integer = true): number {
    const value = read(name);
    if (value === undefined) return fallback;
    const n = Number(value);
    if (Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n))) return n;
    problems.push(`${name} must be ${integer ? "a whole number" : "a number"} from ${min} to ${max} (got "${value}").`);
    return fallback;
  }

  const defaults = DEFAULT_RENDER_CONFIG;
  const model = read("VITE_KOKORO_MODEL");
  if (model !== undefined && !/^[\w.-]+\/[\w.-]+$/.test(model)) problems.push(`VITE_KOKORO_MODEL must be a Hugging Face model id such as ${defaults.kokoroModel} (got "${model}").`);

  let voices = defaults.voices;
  const voiceMap = read("VITE_KOKORO_VOICES");
  if (voiceMap !== undefined) {
    try {
      voices = parseVoicePools(voiceMap);
    } catch (error) {
      problems.push(`VITE_KOKORO_VOICES: ${(error as Error).message}`);
    }
  }

  const rawBitrate = read("VITE_RENDER_VIDEO_BITRATE");
  let videoBitrate: RenderConfig["videoBitrate"] = defaults.videoBitrate;
  if (rawBitrate !== undefined) {
    const bits = Number(rawBitrate);
    if ((QUALITIES as string[]).includes(rawBitrate)) videoBitrate = rawBitrate as VideoQuality;
    else if (Number.isInteger(bits) && bits >= 100_000 && bits <= 50_000_000) videoBitrate = bits;
    else problems.push(`VITE_RENDER_VIDEO_BITRATE must be ${QUALITIES.join(", ")} or bits per second from 100000 to 50000000 (got "${rawBitrate}").`);
  }

  const rawCodecs = read("VITE_RENDER_AUDIO_CODECS");
  let audioCodecs = defaults.audioCodecs;
  if (rawCodecs !== undefined) {
    const listed = rawCodecs.split(",").map((c) => c.trim()).filter(Boolean);
    if (listed.length > 0 && listed.every((c) => c === "aac" || c === "opus")) audioCodecs = [...new Set(listed as AudioCodecChoice[])];
    else problems.push(`VITE_RENDER_AUDIO_CODECS must list aac and/or opus, comma-separated (got "${rawCodecs}").`);
  }

  let sceneHue = defaults.sceneHue;
  try {
    sceneHue = parseSceneHue(read("VITE_SCENE_HUE")) ?? defaults.sceneHue;
  } catch (error) {
    problems.push(`VITE_SCENE_HUE: ${(error as Error).message}`);
  }

  const sceneFontUrl = read("VITE_SCENE_FONT_URL") ?? defaults.sceneFontUrl;
  if (sceneFontUrl !== null && !/^(https:\/\/[^\s]+|[\w.-][\w./-]*)\.(woff2?|ttf|otf)$/i.test(sceneFontUrl)) {
    problems.push(`VITE_SCENE_FONT_URL must be an https URL or a path under the site's base (no leading slash) to a .woff2, .woff, .ttf or .otf file (got "${sceneFontUrl}").`);
  }

  const config: RenderConfig = {
    kokoroModel: model ?? defaults.kokoroModel,
    device: oneOf("VITE_KOKORO_DEVICE", ["auto", "webgpu", "wasm"] as const, defaults.device),
    dtype: {
      webgpu: oneOf("VITE_KOKORO_DTYPE_WEBGPU", DTYPES, defaults.dtype.webgpu),
      wasm: oneOf("VITE_KOKORO_DTYPE_WASM", DTYPES, defaults.dtype.wasm),
    },
    voices,
    fps: number("VITE_RENDER_FPS", defaults.fps, 1, 60),
    videoBitrate,
    keyFrameIntervalS: number("VITE_RENDER_KEYFRAME_S", defaults.keyFrameIntervalS, 0.1, 30, false),
    audioBitrate: number("VITE_RENDER_AUDIO_BITRATE", defaults.audioBitrate, 32_000, 512_000),
    audioCodecs,
    sceneHue,
    sceneFontUrl,
  };
  if (problems.length > 0) throw new Error(`Invalid renderer settings:\n- ${problems.join("\n- ")}`);
  return config;
}
