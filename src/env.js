import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    DATABASE_URL: z.string().url(),
    SUPABASE_URL: z.string().url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    SUPABASE_STORAGE_BUCKET: z.string().default("troupe-media"),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    // Optional provider keys; a key saved in Settings takes precedence.
    GOOGLE_GENAI_API_KEY: z.string().optional(),
    GEMINI_API_KEY: z.string().optional(),
    GOOGLE_API_KEY: z.string().optional(),
    FAL_KEY: z.string().optional(),
    // Newer upstream ids for built-in models: key=id, separated by commas.
    TROUPE_MODEL_IDS: z
      .string()
      .regex(
        /^\s*[a-z0-9.-]+\s*=\s*[a-z0-9][a-z0-9._-]*(\/[a-zA-Z0-9._-]+)*\s*(,\s*[a-z0-9.-]+\s*=\s*[a-z0-9][a-z0-9._-]*(\/[a-zA-Z0-9._-]+)*\s*)*$/,
        "TROUPE_MODEL_IDS: key=id pairs separated by commas, e.g. veo-3.1-fast=veo-3.1-fast-generate-001",
      )
      .optional(),
    // The script chat (src/server/chat): Ollama by default, Claude when an
    // Anthropic key is set. Values saved in Settings take precedence.
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().optional(),
    // Another address for Anthropic's API (a gateway or proxy); the SDK reads it.
    ANTHROPIC_BASE_URL: z.string().url().optional(),
    OLLAMA_URL: z.string().url().optional(),
    OLLAMA_MODEL: z.string().optional(),
    TROUPE_CHAT_PROVIDER: z.enum(["auto", "ollama", "anthropic"]).optional(),
    TROUPE_CHAT_INSTRUCTIONS: z.string().max(2000).optional(),
    TROUPE_CHAT_WORDS_PER_SECOND: z.coerce.number().min(1).max(5).optional(),
    TROUPE_CHAT_TIMEOUT_S: z.coerce.number().int().min(10).max(1800).optional(),
    TROUPE_CHAT_SEND_TIMEOUT_S: z.coerce.number().int().min(30).max(3600).optional(),
    TROUPE_CHAT_TEMPERATURE: z.coerce.number().min(0).max(2).optional(),
    TROUPE_CHAT_HISTORY_TURNS: z.coerce.number().int().min(0).max(20).optional(),
    TROUPE_CHAT_ANTHROPIC_FALLBACK: z.enum(["auto", "on", "off"]).optional(),
    // Guards POST /api/jobs/reconcile — unset = 503.
    RECONCILE_SECRET: z.string().optional(),
    // Read directly by src/server (access-code.ts, settings/secrets.ts,
    // boot.ts); listed here so a typo shows up at startup.
    TROUPE_ACCESS_CODE: z.string().min(12, "TROUPE_ACCESS_CODE must be at least 12 characters").optional(),
    TROUPE_SECRET: z.string().min(16, "TROUPE_SECRET must be at least 16 characters").optional(),
    TROUPE_DATA_DIR: z.string().optional(),
    // The ffprobe that checks each downloaded video (src/server/media/storage.ts).
    FFPROBE_PATH: z.string().optional(),
    TROUPE_INPROCESS_WORKER: z.enum(["0", "1", "true", "false"]).optional(),
    TROUPE_AUTO_MIGRATE: z.enum(["0", "1", "true", "false"]).optional(),
    // Where a copy of the generated access code goes for the Docker CLI (access-code.ts).
    TROUPE_ACCESS_CODE_SHARE_DIR: z.string().optional(),
    // Proxies of your own behind the one facing the internet, for the
    // access-code attempt limit (src/server/api/attempts.ts). Default 0.
    TROUPE_TRUSTED_PROXIES: z.coerce.number().int().min(0).max(10).optional(),
    // Where browsers load the actors' pictures (read by src/server/media/store.ts):
    // a path or URL laid out like public/actors. Default: /actors.
    TROUPE_ACTOR_PORTRAITS_URL: z.string().optional(),
    // First-boot wiring of the Docker stack's renderer (src/server/autoconfigure.ts).
    TROUPE_AUTOCONFIGURE: z.enum(["0", "1", "true", "false"]).optional(),
    TROUPE_RENDERER_URL: z.string().url().optional(),
    TROUPE_RENDERER_TOKEN: z.string().optional(),
    TROUPE_RENDERER_LABEL: z.string().max(80).optional(),
    // The inspiration library (src/server/library, docs/LIBRARY.md).
    TROUPE_LIBRARY: z.enum(["0", "1", "true", "false"]).optional(),
    TROUPE_LIBRARY_OLLAMA_URL: z.string().url().optional(),
    TROUPE_LIBRARY_EMBED_MODEL: z.string().max(200).optional(),
    TROUPE_LIBRARY_VISION_MODEL: z.string().max(200).optional(),
    TROUPE_LIBRARY_OLLAMA_TIMEOUT_S: z.coerce.number().int().min(10).max(3600).optional(),
    TROUPE_LIBRARY_MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(10000).optional(),
    TROUPE_LIBRARY_MAX_DURATION_S: z.coerce.number().int().min(10).max(21600).optional(),
    TROUPE_LIBRARY_FRAMES: z.coerce.number().int().min(1).max(60).optional(),
    TROUPE_LIBRARY_VISION_FRAMES: z.coerce.number().int().min(0).max(60).optional(),
    TROUPE_LIBRARY_FETCH_TIMEOUT_S: z.coerce.number().int().min(5).max(3600).optional(),
    TROUPE_LIBRARY_ALLOW_PRIVATE_URLS: z.enum(["0", "1", "true", "false"]).optional(),
    TROUPE_TRANSCRIBE_URL: z.string().url().optional(),
    TROUPE_TRANSCRIBE_TOKEN: z.string().optional(),
    TROUPE_TRANSCRIBE_TIMEOUT_S: z.coerce.number().int().min(30).max(7200).optional(),
    TROUPE_LIBRARY_WRITE_TIMEOUT_S: z.coerce.number().int().min(30).max(3600).optional(),
    TROUPE_LIBRARY_IDEAS: z.coerce.number().int().min(1).max(10).optional(),
    TROUPE_YTDLP_PATH: z.string().optional(),
    TROUPE_YTDLP_PROXY: z
      .string()
      .regex(
        /^(https?|socks5h?|socks4a?):\/\/\S+$/,
        "TROUPE_YTDLP_PROXY: a proxy URL such as http://proxy:3128 or socks5://proxy:1080",
      )
      .optional(),
    FFMPEG_PATH: z.string().optional(),
    TROUPE_RENDERER_DURATIONS: z
      .string()
      .regex(
        /^\s*\d+\s*(,\s*\d+\s*)*$/,
        "TROUPE_RENDERER_DURATIONS: whole seconds separated by commas, e.g. 4,6,8,10,15",
      )
      .optional(),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    // NEXT_PUBLIC_CLIENTVAR: z.string(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET,
    FAL_KEY: process.env.FAL_KEY,
    NODE_ENV: process.env.NODE_ENV,
    GOOGLE_GENAI_API_KEY: process.env.GOOGLE_GENAI_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    TROUPE_MODEL_IDS: process.env.TROUPE_MODEL_IDS,
    RECONCILE_SECRET: process.env.RECONCILE_SECRET,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
    OLLAMA_URL: process.env.OLLAMA_URL,
    OLLAMA_MODEL: process.env.OLLAMA_MODEL,
    TROUPE_CHAT_PROVIDER: process.env.TROUPE_CHAT_PROVIDER,
    TROUPE_CHAT_INSTRUCTIONS: process.env.TROUPE_CHAT_INSTRUCTIONS,
    TROUPE_CHAT_WORDS_PER_SECOND: process.env.TROUPE_CHAT_WORDS_PER_SECOND,
    TROUPE_CHAT_TIMEOUT_S: process.env.TROUPE_CHAT_TIMEOUT_S,
    TROUPE_CHAT_SEND_TIMEOUT_S: process.env.TROUPE_CHAT_SEND_TIMEOUT_S,
    TROUPE_CHAT_TEMPERATURE: process.env.TROUPE_CHAT_TEMPERATURE,
    TROUPE_CHAT_HISTORY_TURNS: process.env.TROUPE_CHAT_HISTORY_TURNS,
    TROUPE_CHAT_ANTHROPIC_FALLBACK: process.env.TROUPE_CHAT_ANTHROPIC_FALLBACK,
    TROUPE_ACCESS_CODE: process.env.TROUPE_ACCESS_CODE,
    TROUPE_SECRET: process.env.TROUPE_SECRET,
    TROUPE_DATA_DIR: process.env.TROUPE_DATA_DIR,
    FFPROBE_PATH: process.env.FFPROBE_PATH,
    TROUPE_INPROCESS_WORKER: process.env.TROUPE_INPROCESS_WORKER,
    TROUPE_AUTO_MIGRATE: process.env.TROUPE_AUTO_MIGRATE,
    TROUPE_ACCESS_CODE_SHARE_DIR: process.env.TROUPE_ACCESS_CODE_SHARE_DIR,
    TROUPE_TRUSTED_PROXIES: process.env.TROUPE_TRUSTED_PROXIES,
    TROUPE_ACTOR_PORTRAITS_URL: process.env.TROUPE_ACTOR_PORTRAITS_URL,
    TROUPE_AUTOCONFIGURE: process.env.TROUPE_AUTOCONFIGURE,
    TROUPE_RENDERER_URL: process.env.TROUPE_RENDERER_URL,
    TROUPE_RENDERER_TOKEN: process.env.TROUPE_RENDERER_TOKEN,
    TROUPE_RENDERER_LABEL: process.env.TROUPE_RENDERER_LABEL,
    TROUPE_RENDERER_DURATIONS: process.env.TROUPE_RENDERER_DURATIONS,
    TROUPE_LIBRARY: process.env.TROUPE_LIBRARY,
    TROUPE_LIBRARY_OLLAMA_URL: process.env.TROUPE_LIBRARY_OLLAMA_URL,
    TROUPE_LIBRARY_EMBED_MODEL: process.env.TROUPE_LIBRARY_EMBED_MODEL,
    TROUPE_LIBRARY_VISION_MODEL: process.env.TROUPE_LIBRARY_VISION_MODEL,
    TROUPE_LIBRARY_OLLAMA_TIMEOUT_S: process.env.TROUPE_LIBRARY_OLLAMA_TIMEOUT_S,
    TROUPE_LIBRARY_MAX_UPLOAD_MB: process.env.TROUPE_LIBRARY_MAX_UPLOAD_MB,
    TROUPE_LIBRARY_MAX_DURATION_S: process.env.TROUPE_LIBRARY_MAX_DURATION_S,
    TROUPE_LIBRARY_FRAMES: process.env.TROUPE_LIBRARY_FRAMES,
    TROUPE_LIBRARY_VISION_FRAMES: process.env.TROUPE_LIBRARY_VISION_FRAMES,
    TROUPE_LIBRARY_FETCH_TIMEOUT_S: process.env.TROUPE_LIBRARY_FETCH_TIMEOUT_S,
    TROUPE_LIBRARY_ALLOW_PRIVATE_URLS: process.env.TROUPE_LIBRARY_ALLOW_PRIVATE_URLS,
    TROUPE_TRANSCRIBE_URL: process.env.TROUPE_TRANSCRIBE_URL,
    TROUPE_TRANSCRIBE_TOKEN: process.env.TROUPE_TRANSCRIBE_TOKEN,
    TROUPE_TRANSCRIBE_TIMEOUT_S: process.env.TROUPE_TRANSCRIBE_TIMEOUT_S,
    TROUPE_LIBRARY_WRITE_TIMEOUT_S: process.env.TROUPE_LIBRARY_WRITE_TIMEOUT_S,
    TROUPE_LIBRARY_IDEAS: process.env.TROUPE_LIBRARY_IDEAS,
    TROUPE_YTDLP_PATH: process.env.TROUPE_YTDLP_PATH,
    TROUPE_YTDLP_PROXY: process.env.TROUPE_YTDLP_PROXY,
    FFMPEG_PATH: process.env.FFMPEG_PATH,
    // NEXT_PUBLIC_CLIENTVAR: process.env.NEXT_PUBLIC_CLIENTVAR,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
