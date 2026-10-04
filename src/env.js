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
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    // Optional provider keys; a key saved in Settings takes precedence.
    GOOGLE_GENAI_API_KEY: z.string().optional(),
    FAL_KEY: z.string().optional(),
    // The script chat (src/server/chat): Ollama by default, Claude when an
    // Anthropic key is set. Values saved in Settings take precedence.
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().optional(),
    OLLAMA_URL: z.string().url().optional(),
    OLLAMA_MODEL: z.string().optional(),
    TROUPE_CHAT_PROVIDER: z.enum(["auto", "ollama", "anthropic"]).optional(),
    TROUPE_CHAT_INSTRUCTIONS: z.string().max(2000).optional(),
    TROUPE_CHAT_WORDS_PER_SECOND: z.coerce.number().min(1).max(5).optional(),
    TROUPE_CHAT_TIMEOUT_S: z.coerce.number().int().min(10).max(1800).optional(),
    // Guards POST /api/jobs/reconcile — unset = 503.
    RECONCILE_SECRET: z.string().optional(),
    // Read directly by src/server (access-code.ts, settings/secrets.ts,
    // boot.ts); listed here so a typo shows up at startup.
    TROUPE_ACCESS_CODE: z.string().min(12, "TROUPE_ACCESS_CODE must be at least 12 characters").optional(),
    TROUPE_SECRET: z.string().min(16, "TROUPE_SECRET must be at least 16 characters").optional(),
    TROUPE_DATA_DIR: z.string().optional(),
    TROUPE_INPROCESS_WORKER: z.enum(["0", "1", "true", "false"]).optional(),
    TROUPE_AUTO_MIGRATE: z.enum(["0", "1", "true", "false"]).optional(),
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
    RECONCILE_SECRET: process.env.RECONCILE_SECRET,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
    OLLAMA_URL: process.env.OLLAMA_URL,
    OLLAMA_MODEL: process.env.OLLAMA_MODEL,
    TROUPE_CHAT_PROVIDER: process.env.TROUPE_CHAT_PROVIDER,
    TROUPE_CHAT_INSTRUCTIONS: process.env.TROUPE_CHAT_INSTRUCTIONS,
    TROUPE_CHAT_WORDS_PER_SECOND: process.env.TROUPE_CHAT_WORDS_PER_SECOND,
    TROUPE_CHAT_TIMEOUT_S: process.env.TROUPE_CHAT_TIMEOUT_S,
    TROUPE_ACCESS_CODE: process.env.TROUPE_ACCESS_CODE,
    TROUPE_SECRET: process.env.TROUPE_SECRET,
    TROUPE_DATA_DIR: process.env.TROUPE_DATA_DIR,
    TROUPE_INPROCESS_WORKER: process.env.TROUPE_INPROCESS_WORKER,
    TROUPE_AUTO_MIGRATE: process.env.TROUPE_AUTO_MIGRATE,
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
