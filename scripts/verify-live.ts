// pnpm verify:live [--yes] [--only google,fal,...] [--output <folder>]
// Real calls to every provider configured in the environment, through
// Troupe's adapters: free checks and free jobs (Ollama, a ComfyUI render, a
// Supabase upload and delete, a deployed studio's job check) always, paid
// jobs (Google, fal.ai, Anthropic) only with --yes.
// Prints the plan and its cost first; never prints a key. Not run in CI.
// docs/LIVE-CHECKS.md lists the variables each provider reads.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const IDS = ["google", "fal", "anthropic", "ollama", "comfyui", "supabase", "studio"];

const { values } = parseArgs({
  options: {
    yes: { type: "boolean", default: false },
    only: { type: "string" },
    output: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(`Usage: pnpm verify:live [--yes] [--only ${IDS.join(",")}] [--output <folder>]

Without --yes: the free checks (read a model, read a price) and the free
jobs: an Ollama answer, a ComfyUI render, a Supabase upload, signed download
and delete, a deployed studio's health and job check. With --yes, also one
job per paid provider (Google, fal.ai, Anthropic) at its cheapest settings,
billed to your accounts. See docs/LIVE-CHECKS.md.`);
  process.exit(0);
}

const only = (values.only ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const unknown = only.filter((id) => !IDS.includes(id));
if (unknown.length) {
  console.error(`--only takes ${IDS.join(", ")}; not ${unknown.join(", ")}.`);
  process.exit(2);
}

const child = spawn("pnpm", ["exec", "vitest", "run", "--config", "scripts/live/vitest.config.ts", "--reporter", "verbose"], {
  stdio: "inherit",
  env: {
    ...process.env,
    TROUPE_LIVE_YES: values.yes ? "1" : "0",
    TROUPE_LIVE_ONLY: only.join(","),
    TROUPE_LIVE_OUTPUT: resolve(values.output ?? "troupe-live"),
  },
});
child.on("close", (code) => {
  if (!values.yes) console.log("\nPaid jobs (Google, fal.ai, Anthropic) were skipped. Add --yes to run them; the plan above shows what they cost.");
  process.exit(code ?? 1);
});
