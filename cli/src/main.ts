import { emitKeypressEvents } from "node:readline";

import { runCli } from "./cli.ts";
import type { Io } from "./command.ts";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

// A hidden prompt: raw mode, nothing echoed, Ctrl-C aborts.
function promptSecret(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    process.stderr.write(question);
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    let value = "";
    const done = (error?: Error) => {
      input.setRawMode(false);
      input.pause();
      input.off("keypress", onKey);
      process.stderr.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onKey = (text: string | undefined, key: { name?: string; ctrl?: boolean } | undefined) => {
      if (key?.ctrl && key.name === "c") return done(new Error("Cancelled."));
      // Ctrl-D ends the input like Enter; on an empty line it cancels.
      if (key?.ctrl && key.name === "d") return value ? done() : done(new Error("Cancelled."));
      if (key?.name === "return" || key?.name === "enter") return done();
      if (key?.name === "backspace") value = value.slice(0, -1);
      else if (text && !key?.ctrl) value += text;
    };
    input.on("keypress", onKey);
  });
}

const io: Io = {
  env: process.env,
  // `pnpm troupe …` runs from the repository root; INIT_CWD is where it was
  // typed, so relative paths (script files, -o) mean what the user meant.
  cwd: (process.env.npm_lifecycle_event === "troupe" && process.env.INIT_CWD) || process.cwd(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readStdin,
  stdinIsTTY: Boolean(process.stdin.isTTY),
  stderrIsTTY: Boolean(process.stderr.isTTY),
  promptSecret,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

process.exitCode = await runCli(process.argv.slice(2), io);
