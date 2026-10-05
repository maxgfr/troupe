import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";

import { compose, PROJECT, troupe } from "./stack";

// The CLI as the stack ships it: `docker compose run --rm cli …`, signed in
// with the access code the studio saved in its data volume, nothing set by
// hand. Runs after the studio flow (e2e/playwright.config.ts) and finds what
// it made.

const json = (args: string[]) => {
  const run = troupe("--json", ...args);
  expect(run.code, `troupe ${args.join(" ")}: ${run.stderr || run.stdout}`).toBe(0);
  return JSON.parse(run.stdout);
};

test("doctor finds the studio, the stack's renderer, the worker and the chat all working", () => {
  const report = json(["doctor"]) as { ok: boolean; url: string; checks: { name: string; status: string; detail: string }[] };
  expect(report.url).toBe("http://app:3000");
  const status = Object.fromEntries(report.checks.map((c) => [c.name, c.status]));
  expect(status).toMatchObject({
    studio: "ok",
    "sign-in": "ok",
    models: "ok",
    "model local-stack-renderer": "ok",
    worker: "ok",
    chat: "ok",
  });
  expect(report.checks.find((c) => c.name === "models")?.detail).toMatch(/default: local-stack-renderer/);
  expect(report.ok).toBe(true);
});

// Newest first: the one the studio flow just made.
const studioProject = () => {
  const projects = json(["projects", "list"]) as { id: string; title: string }[];
  const project = projects.find((p) => p.title === PROJECT);
  expect(project, "the project the studio flow made").toBeTruthy();
  return project!.id;
};

test("the CLI container sees the access code, and nothing else of the studio's data", () => {
  const seen = compose("run", "--rm", "--no-deps", "--entrypoint", "sh", "cli", "-c", "ls -A /run/troupe-access; test -e /studio && echo studio-mounted; true");
  expect(seen.trim().split("\n")).toEqual(["access-code"]);
});

test("projects list and render list show the studio flow's project and its render", () => {
  const renders = json(["render", "list", "--project", studioProject()]) as { status: string; modelLabel: string }[];
  expect(renders.length).toBeGreaterThan(0);
  expect(renders[0]).toMatchObject({ status: "completed", modelLabel: "Local renderer" });
});

test("download saves the render into the folder the stack mounts for the CLI", () => {
  const cacheDir = resolve(process.env.E2E_CACHE_DIR ?? ".cache/e2e");
  const saved = json(["download", "--project", studioProject(), "-o", "/work/", "--force"]) as { path: string; bytes: number; contentType: string };
  expect(saved.path).toMatch(/^\/work\/docker-end-to-end-.*\.mp4$/);
  expect(saved.contentType).toBe("video/mp4");
  const onHost = join(cacheDir, "cli", saved.path.slice("/work/".length));
  expect(existsSync(onHost)).toBe(true);
  expect(statSync(onHost).size).toBe(saved.bytes);
});
