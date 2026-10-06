import { execFileSync } from "node:child_process";

// What the e2e specs share: the project the studio flow makes, and the
// Compose command scripts/e2e-docker.ts runs the stack with (E2E_COMPOSE).

export const PROJECT = "Docker end to end";

const COMPOSE: string[] = JSON.parse(process.env.E2E_COMPOSE ?? "null") ?? [
  "compose",
  "-p",
  "troupe-e2e",
  "-f",
  "docker-compose.yml",
  "-f",
  "docker-compose.test.yml",
  "--env-file",
  "e2e/stack.env",
  "--profile",
  "cli",
];

// The tag of the stack's images (E2E_TAG, scripts/e2e-docker.ts).
export const TAG = process.env.E2E_TAG || "local";

// `docker compose <args>` for the test stack, from the repository root.
export function compose(...args: string[]): string {
  return execFileSync("docker", [...COMPOSE, ...args], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5 * 60_000,
  });
}

export interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

// `docker compose run --rm cli <args>`, from the repository root.
export function troupe(...args: string[]): CliRun {
  try {
    const stdout = execFileSync("docker", [...COMPOSE, "run", "--rm", "--no-deps", "cli", ...args], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5 * 60_000,
    });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failed.status ?? 1, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
  }
}
