import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";

import type { RenderRequest } from "./request";

// The opt-in AI video mode (docs/LOCAL-MODELS.md#ai-video-mode-ltx-video):
// LTX-Video draws a short silent clip of a person talking to the camera,
// through renderer/ltx/generate.py in its own Python environment. This file
// reads the mode's settings and runs that script; render-ltx.ts turns the
// clip into the finished video.

export const UPSCALERS = ["lanczos", "bicubic", "bilinear", "spline", "neighbor"] as const;
export type Upscaler = (typeof UPSCALERS)[number];
// How a clip shorter than the script fills it: played forwards then
// backwards, or from the start again.
export const LOOPS = ["pingpong", "loop"] as const;
export type Loop = (typeof LOOPS)[number];

export const DEFAULT_LTX_PROMPT =
  "A {person} talks straight to the camera in a {orientation} selfie video filmed on a smartphone held at arm's length, " +
  "like a casual social media review. Head-and-shoulders framing in a bright, tidy living room with soft daylight from a window. " +
  "Natural skin texture, casual clothes, small natural head movements and hand gestures, a warm and friendly expression. " +
  "The scene appears to be real-life footage.";
export const DEFAULT_LTX_NEGATIVE_PROMPT = "worst quality, inconsistent motion, blurry, jittery, distorted, deformed face, extra fingers, text, subtitles, watermark";

export interface LtxSettings {
  // The program and arguments that run generate.py; the job goes to stdin.
  command: string[];
  // Pixels of the generated clip for a vertical video. Other formats keep
  // about the same area, in multiples of 32.
  resolution: { width: number; height: number };
  // Frames generated (8n + 1) and the rate the model is told they play at.
  frames: number;
  frameRate: number;
  // A fixed seed, or a new one for each render.
  seed?: number;
  prompt: string;
  negativePrompt: string;
  upscale: Upscaler;
  loop: Loop;
  // A render that takes longer is stopped.
  timeoutS: number;
}

type Env = Record<string, string | undefined>;

function wholeNumber(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be a whole number between ${min} and ${max} (got "${raw}").`);
  return n;
}

function oneOf<T extends string>(env: Env, name: string, allowed: readonly T[], fallback: T): T {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!(allowed as readonly string[]).includes(raw)) throw new Error(`${name} must be one of ${allowed.join(", ")} (got "${raw}").`);
  return raw as T;
}

// The mode's settings from LTX_* variables, checked. `defaultCommand` runs
// generate.py with uv (see main.ts).
export function ltxSettingsFromEnv(env: Env, defaultCommand: string[]): LtxSettings {
  const command = env.LTX_COMMAND?.trim() ? env.LTX_COMMAND.trim().split(/\s+/) : defaultCommand;
  const resolution = /^(\d+)x(\d+)$/.exec(env.LTX_RESOLUTION?.trim() || "480x832");
  if (!resolution) throw new Error(`LTX_RESOLUTION must look like 480x832 (got "${env.LTX_RESOLUTION}").`);
  const [width, height] = [Number(resolution[1]), Number(resolution[2])];
  if ([width, height].some((side) => side < 64 || side > 1280 || side % 32 !== 0)) {
    throw new Error(`LTX_RESOLUTION sides must be multiples of 32 between 64 and 1280 (got "${env.LTX_RESOLUTION}").`);
  }
  const frames = wholeNumber(env, "LTX_FRAMES", 121, 9, 257);
  if ((frames - 1) % 8 !== 0) throw new Error(`LTX_FRAMES must be a multiple of 8, plus 1, such as 97 or 121 (got ${frames}).`);
  const seed = env.LTX_SEED?.trim() ? wholeNumber(env, "LTX_SEED", 0, 0, 2 ** 31 - 1) : undefined;
  return {
    command,
    resolution: { width, height },
    frames,
    frameRate: wholeNumber(env, "LTX_FPS", 24, 8, 60),
    ...(seed !== undefined ? { seed } : {}),
    prompt: env.LTX_PROMPT?.trim() || DEFAULT_LTX_PROMPT,
    negativePrompt: env.LTX_NEGATIVE_PROMPT?.trim() || DEFAULT_LTX_NEGATIVE_PROMPT,
    upscale: oneOf(env, "LTX_UPSCALE", UPSCALERS, "lanczos"),
    loop: oneOf(env, "LTX_LOOP", LOOPS, "pingpong"),
    timeoutS: wholeNumber(env, "LTX_TIMEOUT_S", 1800, 30, 4 * 3600),
  };
}

function installed(program: string): boolean {
  const runnable = (file: string) => {
    try {
      accessSync(file, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (program.includes("/")) return runnable(program);
  return (process.env.PATH ?? "").split(delimiter).some((dir) => dir && runnable(join(dir, program)));
}

// Why the mode cannot render yet, or null: the program LTX_COMMAND starts
// (uv by default) must be installed and, with the default command, the
// Python environment set up (`venv`), so the first job does not spend
// minutes installing PyTorch. /ltx/health reports it, so Test shows it.
export function ltxReadiness(command: string[], venv?: string): string | null {
  const program = command[0] ?? "";
  if (!installed(program)) return `The AI video mode needs "${program}", which is not installed here. Install uv (https://docs.astral.sh/uv/) or set LTX_COMMAND.`;
  if (venv && !existsSync(join(venv, "pyvenv.cfg"))) {
    return "The AI video mode's Python environment is not set up yet. Run pnpm renderer:ltx:setup on the renderer's machine (it also downloads the weights).";
  }
  return null;
}

const round32 = (n: number) => Math.max(32, Math.round(n / 32) * 32);

// The size to generate for a video of width × height: its shape, with about
// the pixels of `resolution`, in multiples of 32 as the model needs.
export function generationSize(resolution: LtxSettings["resolution"], width: number, height: number): { width: number; height: number } {
  const area = resolution.width * resolution.height;
  const aspect = width / height;
  return { width: round32(Math.sqrt(area * aspect)), height: round32(Math.sqrt(area / aspect)) };
}

const PEOPLE = { female: "woman", male: "man", nonbinary: "person" } as const;

function age(range: string | undefined): string {
  if (!range) return "";
  const plus = /^(\d+)\+$/.exec(range);
  if (plus) return ` aged ${plus[1]} or older`;
  const span = /^(\d+)-(\d+)$/.exec(range);
  return span ? ` aged ${span[1]} to ${span[2]}` : "";
}

// The picture prompt for a job: `template` with {person}, {gender}, {age},
// {name}, {voice_profile} and {orientation} filled in from the script.
export function ltxPrompt(template: string, request: Pick<RenderRequest, "actor" | "width" | "height">): string {
  const { actor, width, height } = request;
  const person = `${actor.gender ? PEOPLE[actor.gender] : "person"}${age(actor.ageRange)}`;
  const values: Record<string, string> = {
    person,
    gender: actor.gender ?? "",
    age: actor.ageRange ?? "",
    name: actor.name,
    voice_profile: actor.voiceProfile ?? "",
    orientation: width === height ? "square" : height > width ? "vertical" : "horizontal",
  };
  return template.replace(/\{(\w+)\}/g, (all, key: string) => values[key] ?? all);
}

// The job generate.py reads on stdin.
export interface GenerateJob {
  prompt: string;
  negative_prompt: string;
  width: number;
  height: number;
  num_frames: number;
  frame_rate: number;
  seed: number;
  out: string;
}

export function generateJob(settings: LtxSettings, request: RenderRequest, out: string): GenerateJob {
  const size = generationSize(settings.resolution, request.width, request.height);
  return {
    prompt: ltxPrompt(settings.prompt, request),
    negative_prompt: settings.negativePrompt,
    ...size,
    num_frames: settings.frames,
    frame_rate: settings.frameRate,
    seed: settings.seed ?? randomInt(2 ** 31 - 1),
    out,
  };
}

// What generate.py reports when it is done.
export interface GenerateReport {
  frames: number;
  width: number;
  height: number;
  seconds: number;
  peak_rss_mb: number;
  device?: string;
}

// Progress through a generation, weighted by what each stage took on an
// Apple M5 (docs/LOCAL-MODELS.md): encoding a new prompt about 40 s,
// loading 6 s, the 8 denoising steps 3 s, decoding the frames 70 s (reported
// tile by tile), writing the clip 2 s.
const STAGES: Record<string, number> = { text: 0.02, load: 0.25, denoise: 0.3, decode: 0.35, write: 0.97 };
const STEPS = [0.3, 0.35] as const;
const DECODES = [0.35, 0.97] as const;
const along = ([from, to]: readonly [number, number], done: unknown, total: unknown) =>
  typeof done === "number" && typeof total === "number" && total > 0 ? from + ((to - from) * Math.min(done, total)) / total : undefined;

// Generations running now, by process group. generate.py runs in its own
// group so that stopping it reaches Python under `uv run` too, which may
// outlive uv and would keep the GPU's memory and the output pipes.
const running = new Set<number>();
const KILL_GRACE_MS = 5000;

function signalGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch {
    // The group is already gone.
  }
}

// Kills every running generation at once: for the renderer's own shutdown.
export function stopGenerators(): void {
  for (const pid of running) signalGroup(pid, "SIGKILL");
}

// Runs generate.py on `job` and resolves once the clip is written.
// `onProgress` gets values in [0, 1].
export async function generateClip(settings: LtxSettings, job: GenerateJob, onProgress: (progress: number) => void = () => {}): Promise<GenerateReport> {
  const [program, ...args] = settings.command;
  if (!program) throw new Error("LTX_COMMAND is empty.");
  const child = spawn(program, args, { stdio: ["pipe", "pipe", "pipe"], detached: true });
  const group = child.pid;
  if (group) running.add(group);
  let stderr = "";
  child.stderr.on("data", (d: Buffer) => {
    // Keep the end: that is where Python puts the error.
    stderr = (stderr + d.toString()).slice(-8000);
  });
  let report: GenerateReport | undefined;
  createInterface({ input: child.stdout }).on("line", (line) => {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof event.stage === "string" && event.stage in STAGES) onProgress(STAGES[event.stage]!);
    const progress = along(STEPS, event.step, event.steps) ?? along(DECODES, event.decode, event.decodes);
    if (progress !== undefined) onProgress(progress);
    if (event.done === true) report = event as unknown as GenerateReport;
  });
  child.stdin.on("error", () => {});
  child.stdin.end(JSON.stringify(job));

  let timedOut = false;
  let grace: NodeJS.Timeout | undefined;
  // SIGTERM lets Python free the GPU; SIGKILL follows if anything lingers.
  const timer = setTimeout(() => {
    timedOut = true;
    if (!group) return;
    signalGroup(group, "SIGTERM");
    grace = setTimeout(() => signalGroup(group, "SIGKILL"), KILL_GRACE_MS);
  }, settings.timeoutS * 1000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on("error", (error: NodeJS.ErrnoException) => {
        reject(
          new Error(
            error.code === "ENOENT"
              ? `Could not start the LTX generator: "${program}" is not installed. Install uv (https://docs.astral.sh/uv/) or set LTX_COMMAND.`
              : `Could not start the LTX generator: ${error.message}`,
          ),
        );
      });
      child.on("close", resolve);
    });
    if (timedOut) throw new Error(`LTX took longer than ${settings.timeoutS} s and was stopped (LTX_TIMEOUT_S).`);
    if (code === null) throw new Error("LTX was stopped.");
    if (code !== 0) {
      const last = stderr.trim().split("\n").filter((l) => l.trim()).at(-1)?.trim();
      throw new Error(last ? `LTX failed: ${last.slice(0, 300)}` : `LTX exited with ${code}.`);
    }
    if (!report) throw new Error("LTX finished without saying it wrote the clip.");
    return report;
  } finally {
    clearTimeout(timer);
    clearTimeout(grace);
    if (group) {
      // Nothing of the generation may outlive it.
      signalGroup(group, "SIGKILL");
      running.delete(group);
    }
  }
}
