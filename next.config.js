/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  // Self-contained server bundle so the Docker image ships without node_modules.
  output: "standalone",
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  // Only Vercel needs the bundled ffprobe; Docker uses the system package.
  ...(process.env.VERCEL ? { outputFileTracingIncludes: { "/*": ["./node_modules/@ffprobe-installer/linux-x64/ffprobe"] } } : {}),
};

export default config;
