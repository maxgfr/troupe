import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { installed } from "./ltx";

// Transcription for Troupe's inspiration library (docs/LIBRARY.md):
// faster-whisper (renderer/whisper/transcribe.py) on this machine's CPU,
// one file at a time. Opt-in like the AI video mode: `--whisper` or
// WHISPER_ENABLED=1 (the Docker image turns it on). The studio posts the
// sound of a saved video to /transcribe and gets timed segments back.

type Env = Record<string, string | undefined>;

export interface WhisperSettings {
  command: string[];
  // tiny, base, small, medium, large-v3, turbo (Systran/faster-whisper-*).
  model: string;
  computeType: string;
  device: string;
  threads: number;
  // An ISO 639-1 code to skip detection; null detects it.
  language: string | null;
  timeoutS: number;
  maxBytes: number;
}

const MODEL = /^[\w./-]{1,200}$/;

function wholeNumber(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be a whole number between ${min} and ${max} (got "${raw}").`);
  return n;
}

export function whisperSettingsFromEnv(env: Env, defaultCommand: string[]): WhisperSettings {
  const model = env.WHISPER_MODEL?.trim() || "base";
  if (!MODEL.test(model)) throw new Error(`WHISPER_MODEL must be a model name such as base or small (got "${model}").`);
  const computeType = env.WHISPER_COMPUTE_TYPE?.trim() || "int8";
  if (!/^[a-z0-9_]+$/.test(computeType)) throw new Error(`WHISPER_COMPUTE_TYPE must be one of int8, int8_float16, float16, float32 (got "${computeType}").`);
  const device = env.WHISPER_DEVICE?.trim() || "cpu";
  if (!["cpu", "cuda", "auto"].includes(device)) throw new Error(`WHISPER_DEVICE must be cpu, cuda or auto (got "${device}").`);
  const language = env.WHISPER_LANGUAGE?.trim() || null;
  if (language && !/^[a-z]{2,3}$/.test(language)) throw new Error(`WHISPER_LANGUAGE must be an ISO 639-1 code such as en or fr (got "${language}").`);
  return {
    command: env.WHISPER_COMMAND?.trim() ? env.WHISPER_COMMAND.trim().split(/\s+/) : defaultCommand,
    model,
    computeType,
    device,
    threads: wholeNumber(env, "WHISPER_THREADS", 0, 0, 256),
    language,
    timeoutS: wholeNumber(env, "WHISPER_TIMEOUT_S", 1800, 10, 7200),
    maxBytes: wholeNumber(env, "WHISPER_MAX_MB", 300, 1, 10_000) * 1024 * 1024,
  };
}

export function whisperReadiness(command: string[], venv?: string): string | null {
  const program = command[0] ?? "";
  if (!installed(program)) return `Transcription needs "${program}", which is not installed on the renderer's machine. Install uv (https://docs.astral.sh/uv/) or set WHISPER_COMMAND.`;
  if (venv && !existsSync(join(venv, "pyvenv.cfg"))) return "Transcription's Python environment is not set up yet. Run pnpm renderer:whisper:setup on the renderer's machine.";
  return null;
}

export function whisperArgs(settings: WhisperSettings, audio: string): string[] {
  return [
    ...settings.command.slice(1),
    audio,
    "--model",
    settings.model,
    "--compute-type",
    settings.computeType,
    "--device",
    settings.device,
    "--threads",
    String(settings.threads),
    ...(settings.language ? ["--language", settings.language] : []),
  ];
}

export interface WhisperResult {
  language: string | null;
  model: string;
  duration?: number;
  segments: { start: number; end: number; text: string }[];
}

// Runs transcribe.py on one file; its own process group, stopped at the
// time limit or when `signal` aborts.
export async function transcribeFile(settings: WhisperSettings, audio: string, signal?: AbortSignal): Promise<WhisperResult> {
  const program = settings.command[0];
  if (!program) throw new Error("WHISPER_COMMAND is empty.");
  const child = spawn(program, whisperArgs(settings, audio), { stdio: ["ignore", "pipe", "pipe"], detached: true });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d: Buffer) => {
    stdout += d.toString();
  });
  child.stderr.on("data", (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-8000);
  });
  const kill = () => {
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    }
  };
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, settings.timeoutS * 1000);
  signal?.addEventListener("abort", kill, { once: true });
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on("error", (error: NodeJS.ErrnoException) => reject(new Error(error.code === "ENOENT" ? `"${program}" is not installed. Install uv or set WHISPER_COMMAND.` : error.message)));
      child.on("close", resolve);
    });
    if (timedOut) throw new Error(`Transcription took longer than ${settings.timeoutS} s and was stopped (WHISPER_TIMEOUT_S).`);
    if (signal?.aborted) throw new Error("The transcription was stopped.");
    if (code !== 0) {
      const last = stderr.trim().split("\n").filter((l) => l.trim()).at(-1)?.trim();
      throw new Error(last ? `Whisper failed: ${last.slice(0, 300)}` : `Whisper exited with ${code}.`);
    }
    const parsed = JSON.parse(stdout) as WhisperResult;
    if (!Array.isArray(parsed.segments)) throw new Error("Whisper answered without segments.");
    return parsed;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", kill);
  }
}
