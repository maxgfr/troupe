// `pnpm e2e:docker`: the whole product, end to end, in Docker. Builds every
// image from this checkout, starts the stack (docker-compose.yml with
// docker-compose.test.yml over it) under its own Compose project, runs the
// Playwright flows in e2e/ against it, then deletes the stack and its volumes.
//
//   pnpm e2e:docker                       # build, start, test, tear down
//   E2E_KEEP=1 pnpm e2e:docker            # leave the stack running afterwards
//   E2E_SKIP_BUILD=1 pnpm e2e:docker      # use images built before (CI)
//   pnpm e2e:docker -- --project studio   # extra arguments go to Playwright
//
// Settings (all optional):
//   E2E_PROJECT       Compose project name (troupe-e2e); only its volumes are deleted
//   E2E_TAG           tag of the images it builds (local); give each checkout its own
//                     tag, project and ports to run two stacks side by side
//   E2E_APP_PORT      studio port on 127.0.0.1 (3190)
//   E2E_WEB_PORT      browser edition port on 127.0.0.1 (3191)
//   E2E_OLLAMA_MODEL  the chat model (qwen2.5:0.5b, about 400 MB)
//   E2E_VISION_MODEL  a vision model for the library (off; e.g. qwen3-vl:2b-instruct)
//   E2E_CACHE_DIR     where model downloads are kept between runs (.cache/e2e)
//   E2E_WEB_RENDER    0 skips the in-browser render of the browser edition
//   E2E_WAIT_S        how long the stack may take to become healthy (1800)
//   E2E_COMPOSE_OVERLAY  one more Compose file over the test one, e.g. to
//                     cap Ollama at a CI runner's two CPUs
//
// The timings it prints (build, first healthy start) are the numbers
// docs/SELF-HOSTING.md quotes.

import { spawn } from "node:child_process";
import { chmodSync, createWriteStream, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "..");
const PROJECT = process.env.E2E_PROJECT || "troupe-e2e";
const CACHE = resolve(REPO, process.env.E2E_CACHE_DIR || ".cache/e2e");
const RESULTS = join(REPO, "e2e", "test-results");
const APP_PORT = process.env.E2E_APP_PORT || "3190";
const WEB_PORT = process.env.E2E_WEB_PORT || "3191";
const WAIT_S = process.env.E2E_WAIT_S || "1800";
const on = (name: string) => process.env[name] === "1" || process.env[name] === "true";

// The Compose command every step (and the CLI tests) runs. --env-file keeps a
// .env next to docker-compose.yml, meant for a real stack, out of the run.
const OVERLAY = process.env.E2E_COMPOSE_OVERLAY ? ["-f", resolve(process.env.E2E_COMPOSE_OVERLAY)] : [];
const COMPOSE = [
  "compose",
  "-p",
  PROJECT,
  "-f",
  "docker-compose.yml",
  "-f",
  "docker-compose.test.yml",
  ...OVERLAY,
  "--env-file",
  join(REPO, "e2e", "stack.env"),
];
// The `cli` service only runs on demand (`run --rm`); build and remove it too.
const WITH_CLI = ["--profile", "cli"];

// For Compose (docker-compose.test.yml) and for the tests (e2e/).
const env: NodeJS.ProcessEnv = {
  ...process.env,
  E2E_CACHE_DIR: CACHE,
  E2E_TAG: process.env.E2E_TAG || "local",
  E2E_APP_PORT: APP_PORT,
  E2E_WEB_PORT: WEB_PORT,
  E2E_APP_URL: `http://127.0.0.1:${APP_PORT}`,
  E2E_WEB_URL: `http://127.0.0.1:${WEB_PORT}`,
  E2E_COMPOSE: JSON.stringify([...COMPOSE, ...WITH_CLI]),
};

function run(
  command: string,
  args: string[],
  options: { quiet?: boolean; log?: string; output?: string[] } = {},
): Promise<number> {
  return new Promise((done, fail) => {
    const piped = Boolean(options.log || options.output);
    const child = spawn(command, args, {
      cwd: REPO,
      env,
      stdio: piped ? ["ignore", "pipe", "pipe"] : options.quiet ? "ignore" : "inherit",
    });
    // Both streams into one file, which closes (and is complete) after both.
    const file = options.log ? createWriteStream(options.log) : null;
    if (file) {
      child.stdout?.pipe(file, { end: false });
      child.stderr?.pipe(file, { end: false });
    }
    child.stdout?.on("data", (chunk: Buffer) => options.output?.push(chunk.toString()));
    child.on("error", fail);
    child.on("close", (code) => {
      if (file) file.end(() => done(code ?? 1));
      else done(code ?? 1);
    });
  });
}

const compose = (args: string[], options?: { quiet?: boolean; log?: string; output?: string[] }) =>
  run("docker", [...COMPOSE, ...args], options);

async function timed(label: string, step: () => Promise<number>): Promise<number> {
  const started = Date.now();
  const code = await step();
  console.log(`[e2e] ${label}: ${((Date.now() - started) / 1000).toFixed(1)} s${code ? ` (exit ${code})` : ""}`);
  return code;
}

// The containers run as their own users, whose ids match nobody on the host
// (Ollama as uid 10001, the renderer and the CLI as node, uid 1000), and
// write into these bind-mounted folders. On a CI runner (uid 1001) the folders
// come back from actions/cache owned by the runner, and on Linux a folder
// Docker creates is root's. World-writable (0777) is what lets every one of
// them write there without knowing the others' ids; it is a throwaway cache
// of public model files, in this checkout only. Open them up as far as this
// user may.
function openUp(path: string) {
  try {
    chmodSync(path, 0o777);
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isDirectory()) openUp(join(path, entry.name));
    }
  } catch {
    // Someone else's: left as it is.
  }
}

async function main(): Promise<number> {
  for (const dir of ["ollama", "kokoro", "huggingface", "cli"]) {
    mkdirSync(join(CACHE, dir), { recursive: true });
    openUp(join(CACHE, dir));
  }
  mkdirSync(RESULTS, { recursive: true });

  // A clean slate: this project's containers and volumes only.
  await compose([...WITH_CLI, "down", "--volumes", "--remove-orphans"], { quiet: true });
  if (!on("E2E_SKIP_BUILD") && (await timed("build", () => compose([...WITH_CLI, "build"])))) return 1;
  const up = await timed("first start, until every service is healthy", () =>
    compose(["up", "--detach", "--no-build", "--wait", "--wait-timeout", WAIT_S]),
  );
  if (up) {
    await compose(["ps", "--all"]);
    // Kept with the test results (CI uploads them), before the stack goes.
    await compose(["logs", "--no-color", "--timestamps"], { log: join(RESULTS, "stack.log") });
    console.log(`[e2e] The services' logs are in ${join(RESULTS, "stack.log")}.`);
    return up;
  }

  // The access code the studio generated on its first start, as a person
  // would read it from `docker compose logs app`.
  const code: string[] = [];
  if (await compose(["exec", "-T", "app", "cat", "/app/data/access-code"], { output: code })) return 1;
  env.E2E_ACCESS_CODE = code.join("").trim();

  const tests = await timed("Playwright", () =>
    run("pnpm", [
      "exec",
      "playwright",
      "test",
      "--config",
      "e2e/playwright.config.ts",
      ...process.argv.slice(2).filter((a) => a !== "--"),
    ]),
  );
  if (tests) await compose(["logs", "--no-color", "--timestamps"], { log: join(RESULTS, "stack.log") });
  return tests;
}

let code = 1;
try {
  code = await main();
} finally {
  if (on("E2E_KEEP")) {
    console.log(
      `[e2e] The stack is still running (E2E_KEEP=1): studio ${env.E2E_APP_URL} (access code ${env.E2E_ACCESS_CODE ?? "in docker compose logs app"}), browser edition ${env.E2E_WEB_URL}/troupe/.`,
    );
    console.log(`[e2e] Stop it with: docker ${COMPOSE.join(" ")} down --volumes`);
  } else {
    await compose([...WITH_CLI, "down", "--volumes", "--remove-orphans"], { quiet: true });
  }
}
process.exit(code);
