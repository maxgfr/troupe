import { defineConfig, devices } from "@playwright/test";

// The flows `pnpm e2e:docker` (scripts/e2e-docker.ts) runs against the Docker
// stack: the self-hosted studio through its pages, the CLI through the stack's
// `cli` container, and the browser edition, served by the `web` service,
// through the site's own tests (site/tests). Run against a stack that is
// already up: E2E_APP_URL, E2E_WEB_URL, E2E_ACCESS_CODE and E2E_COMPOSE set as
// the script sets them.
const APP = process.env.E2E_APP_URL ?? "http://127.0.0.1:3190";
const WEB = process.env.E2E_WEB_URL ?? "http://127.0.0.1:3191";

export default defineConfig({
  outputDir: "./test-results",
  // A chat answer and a render each take seconds to minutes on a CI runner.
  timeout: 15 * 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "./playwright-report" }]] : "list",
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "studio", testDir: ".", testMatch: /studio\.spec\.ts/, use: { ...devices["Desktop Chrome"], baseURL: APP } },
    // After the studio flow: the CLI sees the project it made.
    { name: "cli", testDir: ".", testMatch: /cli\.spec\.ts/, dependencies: ["studio"], use: { baseURL: APP } },
    // Last of the stack's own: it restarts the studio.
    { name: "stack", testDir: ".", testMatch: /stack\.spec\.ts/, dependencies: ["cli"], use: { baseURL: APP } },
    { name: "web", testDir: "../site/tests", testMatch: /(smoke|landing)\.spec\.ts/, use: { ...devices["Desktop Chrome"], baseURL: WEB } },
    // A real render in the page; E2E_WEB_RENDER=0 skips it.
    ...(process.env.E2E_WEB_RENDER === "0" ? [] : [{ name: "web-render", testDir: "../site/tests", testMatch: /render\.spec\.ts/, use: { baseURL: WEB } }]),
  ],
});
