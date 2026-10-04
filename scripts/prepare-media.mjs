// Vercel has no ffprobe: the build ships @ffprobe-installer's static binary
// (an optional dependency, installed only on linux-x64) and marks it
// executable. Docker images use the system ffmpeg package instead.
import { chmodSync } from "node:fs";
import { createRequire } from "node:module";

try {
  chmodSync(createRequire(import.meta.url).resolve("@ffprobe-installer/linux-x64/ffprobe"), 0o755);
} catch {
  if (process.env.VERCEL) throw new Error("@ffprobe-installer/linux-x64 is missing; Vercel builds need it to validate videos.");
}
