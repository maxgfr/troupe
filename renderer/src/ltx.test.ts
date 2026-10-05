import { execFile, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_LTX_NEGATIVE_PROMPT, DEFAULT_LTX_PROMPT, generateClip, generateJob, generationSize, ltxPrompt, ltxReadiness, ltxSettingsFromEnv, stopGenerators, type LtxSettings } from "./ltx";
import { parseJobBody } from "./request";

// The AI video mode's Node side, with a script standing in for
// renderer/ltx/generate.py: no Python, model or GPU needed. Needs ffmpeg.

const run = promisify(execFile);
const FAKE = join(import.meta.dirname, "..", "test", "fake-generate.mjs");
const DEFAULT_COMMAND = ["uv", "run", "python", "generate.py"];

let scratch = "";
beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "troupe-ltx-"));
});
afterAll(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

const settings = (patch: Partial<LtxSettings> = {}): LtxSettings => ({
  ...ltxSettingsFromEnv({}, [process.execPath, FAKE]),
  resolution: { width: 96, height: 160 },
  frames: 25,
  ...patch,
});

const request = parseJobBody({
  prompt: "UGC-style ad",
  width: 720,
  height: 1280,
  duration_s: 6,
  script: {
    language: "en",
    actor: { id: "6f1c0e8a", name: "Léa Martin", gender: "female", age_range: "25-34", voice_profile: "warm" },
    lines: [{ role: "hook", text: "This ended my search.", emotion: "excited" }],
  },
});

describe("ltxSettingsFromEnv", () => {
  it("runs generate.py with uv at 480x832, 121 frames at 24 fps, by default", () => {
    expect(ltxSettingsFromEnv({}, DEFAULT_COMMAND)).toEqual({
      command: DEFAULT_COMMAND,
      resolution: { width: 480, height: 832 },
      frames: 121,
      frameRate: 24,
      prompt: DEFAULT_LTX_PROMPT,
      negativePrompt: DEFAULT_LTX_NEGATIVE_PROMPT,
      upscale: "lanczos",
      loop: "pingpong",
      timeoutS: 1800,
    });
  });

  it("reads every setting from its variable", () => {
    const env = {
      LTX_COMMAND: "/opt/ltx/bin/python /opt/ltx/generate.py",
      LTX_RESOLUTION: "384x672",
      LTX_FRAMES: "97",
      LTX_FPS: "25",
      LTX_SEED: "7",
      LTX_PROMPT: "A {person} waves.",
      LTX_NEGATIVE_PROMPT: "blurry",
      LTX_UPSCALE: "bicubic",
      LTX_LOOP: "loop",
      LTX_TIMEOUT_S: "600",
    };
    expect(ltxSettingsFromEnv(env, DEFAULT_COMMAND)).toEqual({
      command: ["/opt/ltx/bin/python", "/opt/ltx/generate.py"],
      resolution: { width: 384, height: 672 },
      frames: 97,
      frameRate: 25,
      seed: 7,
      prompt: "A {person} waves.",
      negativePrompt: "blurry",
      upscale: "bicubic",
      loop: "loop",
      timeoutS: 600,
    });
  });

  it.each([
    [{ LTX_RESOLUTION: "480p" }, /LTX_RESOLUTION must look like 480x832/],
    [{ LTX_RESOLUTION: "500x832" }, /multiples of 32/],
    [{ LTX_FRAMES: "120" }, /multiple of 8, plus 1/],
    [{ LTX_FRAMES: "1000" }, /between 9 and 257/],
    [{ LTX_UPSCALE: "magic" }, /LTX_UPSCALE must be one of lanczos/],
    [{ LTX_LOOP: "bounce" }, /LTX_LOOP must be one of pingpong, loop/],
    [{ LTX_SEED: "-1" }, /LTX_SEED must be a whole number/],
    [{ LTX_TIMEOUT_S: "5" }, /LTX_TIMEOUT_S must be a whole number between 30/],
  ])("refuses %o", (env, message) => {
    expect(() => ltxSettingsFromEnv(env, DEFAULT_COMMAND)).toThrow(message);
  });
});

describe("generationSize", () => {
  const resolution = { width: 480, height: 832 };
  it("keeps the video's shape and about the configured area, in multiples of 32", () => {
    expect(generationSize(resolution, 720, 1280)).toEqual({ width: 480, height: 832 });
    expect(generationSize(resolution, 1280, 720)).toEqual({ width: 832, height: 480 });
    expect(generationSize(resolution, 1080, 1080)).toEqual({ width: 640, height: 640 });
  });
});

describe("ltxPrompt", () => {
  it("describes the actor and the frame's orientation", () => {
    expect(ltxPrompt("A {person}, {orientation}, {name}, {voice_profile}, {gender} {age} {unknown}", request)).toBe(
      "A woman aged 25 to 34, vertical, Léa Martin, warm, female 25-34 {unknown}",
    );
    expect(ltxPrompt(DEFAULT_LTX_PROMPT, { ...request, width: 1280, height: 720 })).toContain("A woman aged 25 to 34 talks straight to the camera in a horizontal selfie video");
  });

  it("falls back to a person when the job has no script", () => {
    const fromPrompt = parseJobBody({ prompt: "Hello there.", width: 640, height: 640, duration_s: 4 });
    expect(ltxPrompt("A {person}, {orientation}", fromPrompt)).toBe("A person, square");
    expect(ltxPrompt("A {person}", { ...request, actor: { ...request.actor, ageRange: "55+" } })).toBe("A woman aged 55 or older");
  });
});

describe("generateClip", () => {
  it("sends the job to the script, follows its progress and returns its report", async () => {
    const out = join(scratch, "clip.mp4");
    const record = join(scratch, "job.json");
    const job = generateJob(settings({ command: [process.execPath, FAKE, "--record", record], seed: 99 }), request, out);
    const seen: number[] = [];
    const report = await generateClip(settings({ command: [process.execPath, FAKE, "--record", record] }), job, (p) => seen.push(p));

    expect(JSON.parse(await readFile(record, "utf8"))).toEqual({
      prompt: expect.stringContaining("A woman aged 25 to 34"),
      negative_prompt: DEFAULT_LTX_NEGATIVE_PROMPT,
      width: 96,
      height: 160,
      num_frames: 25,
      frame_rate: 24,
      seed: 99,
      out,
    });
    expect(report).toEqual({ done: true, frames: 25, width: 96, height: 160, seconds: 0.1, peak_rss_mb: 42, device: "fake" });
    expect((await stat(out)).size).toBeGreaterThan(0);
    // From encoding the prompt to writing the clip, never backwards.
    expect(seen[0]).toBeLessThan(0.1);
    expect(seen.at(-1)).toBeGreaterThanOrEqual(0.95);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    // Stages weigh what they take on a Mac: the denoising steps are quick and
    // decoding the frames is most of the wait, reported tile by tile.
    // text, load, denoise, 4 steps, decode, 4 decoded tiles, write:
    expect(seen).toHaveLength(13);
    expect(seen[6]).toBeLessThan(0.4);
    expect(seen[8]! - seen[7]!).toBeGreaterThan(0.1);
    expect(seen[11]).toBeGreaterThanOrEqual(0.9);
  });

  it("picks a new seed for each render unless one is set", () => {
    const seeds = new Set(Array.from({ length: 5 }, () => generateJob(settings(), request, "x.mp4").seed));
    expect(seeds.size).toBeGreaterThan(1);
    expect(generateJob(settings({ seed: 3 }), request, "x.mp4").seed).toBe(3);
  });

  it("fails with the script's last error line", async () => {
    const job = generateJob(settings(), request, join(scratch, "never.mp4"));
    await expect(generateClip(settings({ command: [process.execPath, FAKE, "--fail", "RuntimeError: MPS backend out of memory"] }), job)).rejects.toThrow(
      "LTX failed: RuntimeError: MPS backend out of memory",
    );
  });

  it("fails when the script ends without reporting the clip", async () => {
    const job = generateJob(settings(), request, join(scratch, "quiet.mp4"));
    await expect(generateClip(settings({ command: [process.execPath, FAKE, "--no-done"] }), job)).rejects.toThrow("LTX finished without saying it wrote the clip.");
  });

  it("stops a generation that runs past the time limit", async () => {
    const job = generateJob(settings(), request, join(scratch, "slow.mp4"));
    const started = Date.now();
    await expect(generateClip(settings({ command: [process.execPath, FAKE, "--hang"], timeoutS: 1 }), job)).rejects.toThrow("LTX took longer than 1 s and was stopped (LTX_TIMEOUT_S).");
    expect(Date.now() - started).toBeLessThan(5000);
    const { stdout } = await run("pgrep", ["-f", "fake-generate.mjs --hang"]).catch(() => ({ stdout: "" }));
    expect(stdout.trim()).toBe("");
  });

  // A killed process lingers as a zombie until its parent reaps it. The
  // grandchild's parent dies first, so it is adopted by an ancestor that may
  // never reap it (PID 1 in a container, the CI runner's subreaper), and
  // kill(pid, 0) still succeeds on a zombie. Dead means gone or a zombie;
  // anything else after the wait is a process still running.
  function dead(pid: number): boolean {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      return stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z");
    } catch {
      // No /proc (macOS): ask ps.
    }
    try {
      return execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).trim().startsWith("Z");
    } catch {
      return true;
    }
  }
  // SIGKILL is delivered asynchronously: give it a moment, bounded.
  async function diesWithin(pid: number, ms = 3000): Promise<boolean> {
    for (const started = Date.now(); Date.now() - started < ms; await new Promise((r) => setTimeout(r, 50))) {
      if (dead(pid)) return true;
    }
    return dead(pid);
  }
  const pidIn = async (file: string) => {
    for (let i = 0; i < 50; i++) {
      const text = await readFile(file, "utf8").catch(() => "");
      if (text) return Number(text);
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("The fake never started its grandchild.");
  };

  it("stops the whole process tree on a timeout, even a grandchild that ignores SIGTERM", async () => {
    const pidFile = join(scratch, "stubborn-timeout.pid");
    const job = generateJob(settings(), request, join(scratch, "stubborn.mp4"));
    const done = generateClip(settings({ command: [process.execPath, FAKE, "--hang", "--stubborn-child", pidFile], timeoutS: 1 }), job);
    const grandchild = await pidIn(pidFile);
    await expect(done).rejects.toThrow("LTX took longer than 1 s and was stopped (LTX_TIMEOUT_S).");
    expect(await diesWithin(grandchild)).toBe(true);
  }, 15_000);

  it("stops running generations when the renderer shuts down", async () => {
    const pidFile = join(scratch, "stubborn-stop.pid");
    const job = generateJob(settings(), request, join(scratch, "stopped.mp4"));
    const done = generateClip(settings({ command: [process.execPath, FAKE, "--hang", "--stubborn-child", pidFile] }), job);
    const grandchild = await pidIn(pidFile);
    stopGenerators();
    await expect(done).rejects.toThrow(/LTX/);
    expect(await diesWithin(grandchild)).toBe(true);
  });

  it("says how to install uv when it is missing", async () => {
    const job = generateJob(settings(), request, join(scratch, "none.mp4"));
    await expect(generateClip(settings({ command: ["troupe-no-such-uv", "run"] }), job)).rejects.toThrow(
      'Could not start the LTX generator: "troupe-no-such-uv" is not installed. Install uv (https://docs.astral.sh/uv/) or set LTX_COMMAND.',
    );
  });
});

describe("ltxReadiness", () => {
  it("is ready when the program is on the PATH and the environment is set up", async () => {
    const venv = join(scratch, "venv-ready");
    await mkdir(venv, { recursive: true });
    await writeFile(join(venv, "pyvenv.cfg"), "home = /usr/bin\n");
    expect(ltxReadiness(["node", "generate.py"], venv)).toBeNull();
    expect(ltxReadiness([process.execPath, FAKE])).toBeNull();
  });

  it("says when uv, or another LTX_COMMAND program, is missing", () => {
    expect(ltxReadiness(["troupe-no-such-uv", "run"])).toBe(
      'The AI video mode needs "troupe-no-such-uv", which is not installed here. Install uv (https://docs.astral.sh/uv/) or set LTX_COMMAND.',
    );
    expect(ltxReadiness(["/opt/nowhere/python", "generate.py"])).toMatch(/needs "\/opt\/nowhere\/python", which is not installed here/);
  });

  it("says to run the setup when the Python environment is missing", () => {
    expect(ltxReadiness(["node"], join(scratch, "no-venv"))).toBe(
      "The AI video mode's Python environment is not set up yet. Run pnpm renderer:ltx:setup on the renderer's machine (it also downloads the weights).",
    );
  });
});
