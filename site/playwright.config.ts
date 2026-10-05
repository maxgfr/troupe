import { defineConfig, devices } from "@playwright/test";

// Smoke test of the built browser edition, served the way GitHub Pages serves
// it (`pnpm site:build` first). Run with `pnpm site:test`. SITE_PORT picks
// another port, so a second checkout can run it while one preview is up.
const PORT = Number(process.env.SITE_PORT ?? 4173);

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "./playwright-report" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /(render|chat)\.spec\.ts/ },
    // A real render (tests/render.spec.ts): `pnpm site:test:render`.
    { name: "render", testMatch: /render\.spec\.ts/ },
    // The chat with WebLLM on the GPU (tests/chat.spec.ts), local only: `pnpm site:test:chat`.
    { name: "chat", testMatch: /chat\.spec\.ts/ },
  ],
  webServer: {
    command: `pnpm site:preview --port ${PORT}`,
    url: `http://localhost:${PORT}/troupe/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
