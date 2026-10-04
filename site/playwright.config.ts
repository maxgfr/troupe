import { defineConfig, devices } from "@playwright/test";

// Smoke test of the built static demo, served the way GitHub Pages serves it
// (`pnpm site:build` first). Run with `pnpm site:test`.
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
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm site:preview",
    url: "http://localhost:4173/troupe/",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
