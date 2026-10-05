import { expect, test } from "@playwright/test";

import { compose, PROJECT, troupe } from "./stack";

// The stack itself, last (e2e/playwright.config.ts): health, the access code,
// requests that claim to come from localhost, and a restart that keeps the
// data and leaves the first-boot wiring as it was.

test("the health check answers and the generated access code is in the logs", async ({ request }) => {
  const health = await request.get("/api/health");
  expect(health.ok()).toBe(true);
  expect(await health.json()).toMatchObject({ ok: true });
  const logs = compose("logs", "--no-color", "app");
  expect(logs).toContain("Troupe is protected by an access code:");
  expect(logs).toContain(process.env.E2E_ACCESS_CODE ?? "missing");
});

test("the browser edition is served with its security headers", async ({ request }) => {
  const web = process.env.E2E_WEB_URL ?? "http://127.0.0.1:3191";
  const page = await request.get(`${web}/troupe/app/dashboard`);
  expect(page.status()).toBe(200);
  const csp = page.headers()["content-security-policy"] ?? "";
  for (const part of ["default-src 'self'", "'wasm-unsafe-eval'", "worker-src 'self' blob:", "frame-ancestors 'none'", "https://huggingface.co", "'sha256-"]) expect(csp).toContain(part);
  expect(csp).not.toContain("'unsafe-eval'");
  expect(page.headers()["x-frame-options"]).toBe("DENY");
  expect(page.headers()["x-content-type-options"]).toBe("nosniff");
  const worker = await request.get(`${web}/troupe/sw.js`);
  expect(worker.headers()).toMatchObject({ "cache-control": "no-cache", "service-worker-allowed": "/troupe/" });
});

test("a spoofed localhost Host header gets nothing", async ({ request, baseURL }) => {
  const response = await request.get(`${baseURL}/api/trpc/identity.myWorkspaces`, { headers: { host: "localhost:3100" } });
  expect(response.status()).toBe(401);
});

test("a restart keeps the access code, the projects and the renderer as they were", () => {
  const code = compose("exec", "-T", "app", "cat", "/app/data/access-code").trim();
  compose("restart", "app");
  compose("up", "--detach", "--no-build", "--wait", "--wait-timeout", "180", "app");
  expect(compose("exec", "-T", "app", "cat", "/app/data/access-code").trim()).toBe(code);
  // The first-boot wiring found its model and changed nothing.
  expect(compose("logs", "--no-color", "app")).toMatch(/"event":"autoconfigure\.renderer","outcome":"exists"/);
  const models = JSON.parse(troupe("--json", "models", "list").stdout) as { models: { key: string }[]; defaultModelKey: string | null };
  expect(models.models.filter((m) => m.key.startsWith("local-"))).toHaveLength(1);
  expect(models.defaultModelKey).toBe("local-stack-renderer");
  expect(troupe("projects", "list").stdout).toContain(PROJECT);
});
