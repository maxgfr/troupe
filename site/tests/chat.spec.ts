import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";

import { watchConsole } from "./page-checks";

// The script chat in the browser edition, for real: WebLLM runs the chat model
// on the GPU, the proposal is applied as a new version, then relaunched with
// the in-browser renderer. Run it with `pnpm site:test:chat` after
// `pnpm site:build` (docs/BROWSER-EDITION.md).
//
// Local only: it needs WebGPU (headed Chrome on a machine with a GPU; CI
// runners have none) and downloads the chat model (about 880 MB) into the
// browser profile once. The profile is the render test's (RENDER_PROFILE,
// default in the OS temp folder), so the voice model is shared too. The
// library's test below reuses the same model for its analysis, its chat and
// its ideas.

const APP = "/troupe/app";
const PROFILE = process.env.RENDER_PROFILE ?? join(tmpdir(), "troupe-render-test-profile");
const SCRIPT = "This coffee is good.\nIt is made from beans.\nBuy it now.";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
const errors: string[] = [];

// biome-ignore lint/correctness/noEmptyPattern: Playwright wants the fixtures argument destructured, and this hook uses none.
test.beforeAll(async ({}, testInfo) => {
  mkdirSync(PROFILE, { recursive: true });
  rmSync(join(PROFILE, "Default", "History"), { force: true });
  context = await chromium.launchPersistentContext(PROFILE, {
    channel: process.env.RENDER_CHANNEL ?? "chrome",
    headless: process.env.HEADLESS === "1",
    viewport: { width: 1280, height: 900 },
    baseURL: testInfo.project.use.baseURL,
    args: (process.env.RENDER_ARGS ?? "").split(" ").filter(Boolean),
  });
  page = context.pages()[0] ?? (await context.newPage());
  watchConsole(page, errors);
});

test.afterAll(async () => {
  await context?.close();
});

const chat = () => page.getByRole("complementary", { name: "Script chat" });
const proposals = () => chat().getByText(/^(Compared with version \d+|Applied as version \d+|First script)$/);

// `answered`: how many proposals the chat shows once this one arrives.
async function ask(request: string, answered: number) {
  await chat().getByLabel("Ask for a change").fill(request);
  await chat().getByRole("button", { name: "Send" }).click();
  await expect(chat().getByText(/is writing a new version/)).toBeVisible();
  // The first request downloads the model; later ones answer in seconds.
  await expect(chat().getByText(/is writing a new version/)).toBeHidden({ timeout: 15 * 60_000 });
  await expect(chat().getByRole("alert")).toHaveCount(0);
  await expect(proposals()).toHaveCount(answered);
}

test("asks the in-browser model for a change, applies it, then relaunches the render", async () => {
  test.setTimeout(25 * 60_000);
  await page.goto(`${APP}/projects/new`);
  await page.getByLabel("Project title").fill("Chat in the browser");
  for (let step = 0; step < 3; step++) await page.getByRole("button", { name: "Continue" }).click();
  await page.locator('label:has(input[name="actor"]:not([disabled]))').first().click();
  await page.getByRole("button", { name: /Create project/ }).click();
  await expect(page).toHaveURL(/\/script$/);
  await page.getByLabel(/Write or paste your script/).fill(SCRIPT);
  await page.getByRole("button", { name: "Save as new version" }).click();
  await expect(page.getByText(/version 1 · written here/)).toBeVisible();
  const projectUrl = page.url().replace(/\/script$/, "");
  await page.goto(projectUrl);

  await expect(chat().getByText(/This browser · Qwen/)).toBeVisible({ timeout: 30_000 });
  await ask("Make the hook punchier and more excited.", 1);
  await page.screenshot({ path: test.info().outputPath("proposal.png") });
  // Plain spoken text: no Markdown reaches the voice or the captions.
  expect(await chat().locator("ol").last().innerText()).not.toMatch(/[*`]/);

  // Apply only: a new version from the chat, with the model's roles and emotions.
  await chat().getByRole("button", { name: "Apply only" }).last().click();
  await expect(chat().getByText("Applied as version 2")).toBeVisible();
  await page.goto(`${projectUrl}/script`);
  await expect(page.getByText(/version 2 · from the chat/)).toBeVisible();

  // Apply & relaunch: version 3, rendered in this tab.
  await page.goto(projectUrl);
  await ask("Make the last line a warmer call to action.", 2);
  await chat().getByRole("button", { name: "Apply & relaunch" }).last().click();
  await expect(chat().getByText("Applied as version 3")).toBeVisible();
  await expect(page.getByLabel(/^Latest completed render/)).toBeVisible({ timeout: 8 * 60_000 });
  await expect(page.getByText("completed", { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("relaunched.png") });

  // The conversation is kept in this browser's database.
  await page.reload();
  await expect(proposals()).toHaveCount(2);
  await page.goto(`${projectUrl}/script`);
  await expect(page.getByText(/version 3 · from the chat/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("reads a video into the library, answers about it with citations, and writes ideas that become a project", async () => {
  test.setTimeout(25 * 60_000);
  await page.goto(`${APP}/library`);
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible({ timeout: 60_000 });
  // The profile is kept between runs: this run's clip is the newest row.
  const rows = page.locator("table tbody tr");
  await expect(rows.first().or(page.getByText("Save your first piece"))).toBeVisible({ timeout: 60_000 });
  const before = await rows.count();
  await page
    .locator('input[type="file"]')
    .setInputFiles(fileURLToPath(new URL("fixtures/library-clip.mp4", import.meta.url)));
  await expect(rows).toHaveCount(before + 1);
  const row = rows.first();
  await expect(row.getByText("ready")).toBeVisible({ timeout: 15 * 60_000 });
  await row.getByRole("link", { name: /library clip/i }).click();
  // The in-browser model wrote the structure and the tags.
  await expect(page.getByRole("heading", { name: "Structure" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("library-item.png"), fullPage: true });

  const ask = page.getByRole("complementary", { name: "Ask about this item" });
  await ask.getByLabel("Ask about this item").fill("Why does this hook work?");
  await ask.getByRole("button", { name: "Ask" }).click();
  await expect(ask.getByText(/is reading your library/)).toBeHidden({ timeout: 10 * 60_000 });
  await expect(ask.getByRole("alert")).toHaveCount(0);
  await expect(ask.getByRole("list", { name: "Sources" }).first()).toBeVisible();

  // The 1.5B model now and then writes an answer that is not a script (about
  // one try in five here); the page says to try again, and so does the test.
  const created = page.getByRole("button", { name: "Create project" }).first();
  const refused = page.getByRole("alert").filter({ hasText: "did not write usable scripts" });
  await page.getByRole("button", { name: "5 ideas in this style" }).click();
  await expect(created.or(refused)).toBeVisible({ timeout: 10 * 60_000 });
  if (await refused.isVisible()) {
    await page.getByRole("button", { name: "5 ideas in this style" }).click();
    await expect(created).toBeVisible({ timeout: 10 * 60_000 });
  }
  await page.getByRole("button", { name: "Create project" }).first().click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await page.goto(`${page.url()}/script`);
  await expect(page.getByText(/version 1 · from the chat/)).toBeVisible();
  expect(errors).toEqual([]);
});
