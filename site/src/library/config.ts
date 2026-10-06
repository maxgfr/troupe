// What a fork can change about the browser edition's library, read from
// VITE_* variables when the site is built (site/.env.example). The build
// runs this parser too (site/vite.config.ts), so a bad value stops it.

export interface BrowserLibraryConfig {
  // A Whisper ONNX export for transformers.js, with timestamps.
  whisperModel: string;
  whisperDtype: string;
  // A sentence-embedding ONNX export; e5 models get their "query: " and
  // "passage: " prefixes.
  embedModel: string;
  embedDtype: string;
  // Where the models run: wasm (every browser, one CPU thread), webgpu, or
  // auto (WebGPU when the browser has it).
  device: "auto" | "webgpu" | "wasm";
  // Shown before the first analysis, in megabytes; 0 hides the figure.
  downloadMb: number;
  // The largest file kept in this browser, and the longest video or sound
  // it analyses (decoding and transcribing in a tab take time and memory).
  maxUploadMb: number;
  maxMinutes: number;
  // Pictures taken from a video.
  frames: number;
}

// Whisper base (77 MB in 8-bit) and multilingual-e5-small (118 MB in 8-bit):
// both read French, English and some ninety other languages, on one CPU
// thread, in any recent browser.
export const DEFAULT_LIBRARY_CONFIG: BrowserLibraryConfig = {
  whisperModel: "onnx-community/whisper-base",
  whisperDtype: "q8",
  embedModel: "Xenova/multilingual-e5-small",
  embedDtype: "q8",
  device: "wasm",
  downloadMb: 195,
  maxUploadMb: 300,
  maxMinutes: 15,
  frames: 8,
};

const DTYPES = ["fp32", "fp16", "q8", "int8", "uint8", "q4", "q4f16", "bnb4"];
const MODEL = /^[\w.-]+\/[\w.-]+$/;

type Env = Record<string, string | boolean | undefined>;

export function parseLibraryConfig(env: Env): BrowserLibraryConfig {
  const problems: string[] = [];
  const read = (name: string) => {
    const value = env[name];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
  };
  const d = DEFAULT_LIBRARY_CONFIG;
  const model = (name: string, fallback: string) => {
    const value = read(name);
    if (value !== undefined && !MODEL.test(value)) problems.push(`${name} must be a Hugging Face model id such as ${fallback} (got "${value}").`);
    return value ?? fallback;
  };
  const dtype = (name: string, fallback: string) => {
    const value = read(name);
    if (value !== undefined && !DTYPES.includes(value)) problems.push(`${name} must be one of ${DTYPES.join(", ")} (got "${value}").`);
    return value ?? fallback;
  };
  const whole = (name: string, fallback: number, min: number, max: number) => {
    const raw = read(name);
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (Number.isInteger(n) && n >= min && n <= max) return n;
    problems.push(`${name} must be a whole number from ${min} to ${max} (got "${raw}").`);
    return fallback;
  };
  const whisperModel = model("VITE_LIBRARY_WHISPER_MODEL", d.whisperModel);
  const embedModel = model("VITE_LIBRARY_EMBED_MODEL", d.embedModel);
  const device = read("VITE_LIBRARY_DEVICE") ?? d.device;
  if (device !== "auto" && device !== "webgpu" && device !== "wasm") problems.push(`VITE_LIBRARY_DEVICE must be auto, webgpu or wasm (got "${device}").`);
  // A size only makes sense for the models it was measured on.
  const known = whisperModel === d.whisperModel && embedModel === d.embedModel;
  const config: BrowserLibraryConfig = {
    whisperModel,
    whisperDtype: dtype("VITE_LIBRARY_WHISPER_DTYPE", d.whisperDtype),
    embedModel,
    embedDtype: dtype("VITE_LIBRARY_EMBED_DTYPE", d.embedDtype),
    device: device as BrowserLibraryConfig["device"],
    downloadMb: whole("VITE_LIBRARY_DOWNLOAD_MB", known ? d.downloadMb : 0, 0, 100_000),
    maxUploadMb: whole("VITE_LIBRARY_MAX_UPLOAD_MB", d.maxUploadMb, 1, 4000),
    maxMinutes: whole("VITE_LIBRARY_MAX_MINUTES", d.maxMinutes, 1, 240),
    frames: whole("VITE_LIBRARY_FRAMES", d.frames, 1, 30),
  };
  if (problems.length > 0) throw new Error(`Invalid library settings:\n- ${problems.join("\n- ")}`);
  return config;
}
