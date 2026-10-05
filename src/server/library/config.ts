// The library's settings in the self-hosted studio, from the environment
// (.env.example, docs/LIBRARY.md). src/env.js rejects bad values at startup;
// here a bad one falls back to its default.

type Env = Record<string, string | undefined>;

export const DEFAULT_EMBED_MODEL = "qwen3-embedding:0.6b";
export const DEFAULT_VISION_MODEL = "qwen3-vl:2b-instruct";

export interface LibraryEnvironment {
  enabled: boolean;
  // Ollama for embeddings and vision (default: the chat's OLLAMA_URL).
  ollamaUrl: string;
  embedModel: string | null;
  visionModel: string | null;
  // The renderer's /transcribe (docker-compose.yml: http://renderer:8078).
  transcribeUrl: string | null;
  transcribeToken: string | null;
  transcribeTimeoutMs: number;
  maxUploadBytes: number;
  maxDurationS: number;
  frames: number;
  visionFrames: number;
  ollamaTimeoutMs: number;
  fetchTimeoutMs: number;
  allowPrivateUrls: boolean;
  ytDlpPath: string;
  ffmpegPath: string;
}

const number = (raw: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number(raw);
  return raw?.trim() && Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

const on = (raw: string | undefined, fallback: boolean) => (raw === undefined || raw.trim() === "" ? fallback : raw === "1" || raw === "true");

// An empty value, "off" or "none" turns a model off.
const model = (raw: string | undefined, fallback: string) => {
  const value = raw?.trim();
  if (value === undefined) return fallback;
  return value === "" || value === "off" || value === "none" ? null : value;
};

export function libraryEnvironment(env: Env = process.env): LibraryEnvironment {
  return {
    enabled: on(env.TROUPE_LIBRARY, true),
    ollamaUrl: env.TROUPE_LIBRARY_OLLAMA_URL?.trim() || env.OLLAMA_URL?.trim() || "http://127.0.0.1:11434",
    embedModel: model(env.TROUPE_LIBRARY_EMBED_MODEL, DEFAULT_EMBED_MODEL),
    visionModel: model(env.TROUPE_LIBRARY_VISION_MODEL, DEFAULT_VISION_MODEL),
    transcribeUrl: env.TROUPE_TRANSCRIBE_URL?.trim() || null,
    transcribeToken: env.TROUPE_TRANSCRIBE_TOKEN?.trim() || env.TROUPE_RENDERER_TOKEN?.trim() || null,
    transcribeTimeoutMs: number(env.TROUPE_TRANSCRIBE_TIMEOUT_S, 1800, 30, 7200) * 1000,
    maxUploadBytes: number(env.TROUPE_LIBRARY_MAX_UPLOAD_MB, 500, 1, 10_000) * 1024 * 1024,
    maxDurationS: number(env.TROUPE_LIBRARY_MAX_DURATION_S, 3600, 10, 6 * 3600),
    frames: Math.round(number(env.TROUPE_LIBRARY_FRAMES, 12, 1, 60)),
    visionFrames: Math.round(number(env.TROUPE_LIBRARY_VISION_FRAMES, 6, 0, 60)),
    ollamaTimeoutMs: number(env.TROUPE_LIBRARY_OLLAMA_TIMEOUT_S, 300, 10, 3600) * 1000,
    fetchTimeoutMs: number(env.TROUPE_LIBRARY_FETCH_TIMEOUT_S, 60, 5, 3600) * 1000,
    allowPrivateUrls: on(env.TROUPE_LIBRARY_ALLOW_PRIVATE_URLS, false),
    ytDlpPath: env.TROUPE_YTDLP_PATH?.trim() || "yt-dlp",
    ffmpegPath: env.FFMPEG_PATH?.trim() || "ffmpeg",
  };
}
