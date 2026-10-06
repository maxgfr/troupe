import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Next's tsconfig keeps jsx: preserve for SWC; vitest (rolldown/oxc) needs
  // the automatic runtime enabled explicitly for .tsx test files.
  oxc: {
    jsx: {
      runtime: "automatic",
      importSource: "react",
    },
  },
  test: {
    include: [
      "src/**/*.test.{ts,tsx}",
      "renderer/src/**/*.test.ts",
      "cli/src/**/*.test.ts",
      "site/*.test.ts",
      "site/src/**/*.test.ts",
      "scripts/live/*.test.ts",
    ],
    environment: "node",
    // FIX-005 (c7): each pglite-backed `it` rebuilds a fresh in-memory Postgres
    // and replays every migration; under the full parallel run that contention
    // can brush the 5 s default even though a file passes in ~2 s alone. Give
    // db-heavy specs headroom so a slow scheduler slot never reads as a failure.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Each worker owns a real PGlite engine; bound memory on laptops and CI.
    maxWorkers: 4,
    env: {
      // Tests run on pglite (src/test/db.ts); the runtime client from
      // ~/server/db is imported but never queried, so a placeholder URL and
      // skipped validation keep env.js happy without a live database.
      SKIP_ENV_VALIDATION: "1",
      DATABASE_URL: "postgresql://placeholder:placeholder@localhost:5432/placeholder",
    },
  },
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
