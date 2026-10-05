// Stands in for renderer/ltx/generate.py in tests: reads the same job on
// stdin, reports the same progress lines and writes a clip of one flat color
// with ffmpeg, so the AI video mode is tested without Python or a GPU.
//
//   node fake-generate.mjs [--color 0x2a6fdb] [--record job.json]
//                          [--fail "message"] [--hang] [--no-done]
//                          [--stubborn-child pid.txt]
//
// --stubborn-child starts a grandchild that ignores SIGTERM and shares the
// script's stdout and stderr, as Python does under `uv run`, and writes its
// pid to the file.
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

const job = JSON.parse(readFileSync(0, "utf8"));
if (value("--record")) writeFileSync(value("--record"), JSON.stringify(job));
if (value("--stubborn-child")) {
  const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], { stdio: ["ignore", "inherit", "inherit"] });
  writeFileSync(value("--stubborn-child"), String(child.pid));
}
emit({ stage: "text" });
emit({ stage: "load" });
// Noise a library might print on stdout: ignored by the renderer.
process.stdout.write("Loading checkpoint shards: 100%\n");
if (flag("--hang")) setInterval(() => {}, 1000);
else if (value("--fail")) {
  process.stderr.write(`Traceback (most recent call last):\n  File "generate.py", line 1\n${value("--fail")}\n`);
  process.exit(1);
} else {
  emit({ stage: "denoise" });
  for (let step = 1; step <= 4; step++) emit({ step, steps: 4 });
  emit({ stage: "decode" });
  for (let decode = 1; decode <= 4; decode++) emit({ decode, decodes: 4 });
  emit({ stage: "write" });
  const color = value("--color") ?? "0x2a6fdb";
  const seconds = job.num_frames / job.frame_rate;
  execFileSync(process.env.FFMPEG ?? "ffmpeg", [
    "-y", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${color}:s=${job.width}x${job.height}:r=${job.frame_rate}:d=${seconds}`,
    "-frames:v", String(job.num_frames), "-c:v", "libx264", "-pix_fmt", "yuv420p", job.out,
  ]);
  if (!flag("--no-done")) emit({ done: true, frames: job.num_frames, width: job.width, height: job.height, seconds: 0.1, peak_rss_mb: 42, device: "fake" });
}
