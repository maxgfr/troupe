import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { describeCost, ffprobeFile, freeCheck, liveHttp, paidTotal, planChecks, planTable, runCheck, type Deps } from "./checks";

// Run by pnpm verify:live, which sets TROUPE_LIVE_YES, TROUPE_LIVE_ONLY and
// TROUPE_LIVE_OUTPUT from its flags. See docs/LIVE-CHECKS.md.

const env = process.env;
const confirmed = env.TROUPE_LIVE_YES === "1";
const only = (env.TROUPE_LIVE_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const checks = planChecks(env).filter((c) => only.length === 0 || only.includes(c.id));
const deps: Deps = {
  env,
  http: liveHttp,
  fetch,
  outDir: env.TROUPE_LIVE_OUTPUT || join(process.cwd(), "troupe-live"),
  ffprobe: (file) => ffprobeFile(file, env),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log: (line) => console.log(line),
};

console.log(`\nLive checks (${confirmed ? "paid jobs confirmed with --yes" : "free checks only; paid jobs need --yes"}):\n${planTable(checks)}\nPaid jobs: ${paidTotal(checks) ? `${describeCost(paidTotal(checks))} in all` : "none configured"}.\n`);

describe.each(checks.map((c) => [c.name, c] as const))("%s", (_name, check) => {
  it.skipIf(Boolean(check.skip))("free check: the key or address works", async () => {
    const report = await freeCheck(check, deps);
    console.log(`${check.name}: ${report.message}`);
    expect(report.ok, report.message).not.toBe(false);
  });

  const paid = check.estimateUsd !== null;
  it.skipIf(Boolean(check.skip) || (paid && !confirmed))(`${check.job} (${describeCost(check.estimateUsd)})`, async () => {
    const line = await runCheck(check, deps);
    console.log(`${check.name}: ${line}`);
  });
});
