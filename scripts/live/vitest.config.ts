import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// pnpm verify:live (scripts/verify-live.ts): the live provider checks, one
// file, run in order, with room for a slow render. Never part of pnpm test.
export default defineConfig({
  test: {
    include: ["scripts/live/live.verify.ts"],
    environment: "node",
    testTimeout: 70 * 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    sequence: { concurrent: false },
    env: { SKIP_ENV_VALIDATION: "1" },
  },
  resolve: { alias: { "~": fileURLToPath(new URL("../../src", import.meta.url)) } },
});
