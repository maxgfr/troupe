import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

// The browser edition on the visitor's own OpenRouter key, for real: the key
// saved in Settings, an actor made with a photo model, then the assistant
// adding a video model and rendering a shot of that actor once confirmed,
// and the script chat answering on OpenRouter. It spends about $0.15 of
// OpenRouter credit, so it runs only when asked:
//
//   OPENROUTER_KEY_FILE=~/openrouter.key pnpm site:test:openrouter
//
// (pnpm site:build first). The key is read from the file, typed into the
// page, and never printed.

const keyFile = process.env.OPENROUTER_KEY_FILE;
test.skip(!keyFile, "Set OPENROUTER_KEY_FILE to a file holding an OpenRouter key.");

test.describe.configure({ mode: "serial" });
test.setTimeout(900_000);

test("an actor, a model, a shot and a script, on OpenRouter from the browser", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  // The key, sealed in this browser.
  await page.goto("/troupe/app/settings#provider-accounts");
  const field = page.locator("#key-openrouter");
  await field.fill(readFileSync(keyFile!, "utf8").trim());
  await page.getByRole("button", { name: "Save key" }).click();
  const accounts = page.locator("#provider-accounts");
  await expect(accounts.getByRole("button", { name: "Test" })).toBeVisible({ timeout: 60_000 });
  await accounts.getByRole("button", { name: "Test" }).click();
  await expect(page.getByText(/OpenRouter accepts the key/i)).toBeVisible({ timeout: 60_000 });

  // An actor, drawn on the key.
  await page.goto("/troupe/app/actors");
  await page.getByRole("button", { name: "Create an actor" }).click();
  await page.getByRole("button", { name: "Local bakery owner" }).click();
  await page.getByRole("button", { name: "Create the actor" }).click();
  await expect(page.getByRole("status").filter({ hasText: "is ready" })).toBeVisible({ timeout: 240_000 });
  const portrait = page.locator('img[alt^="Hélène"]').first();
  await expect(portrait).toBeVisible();
  await expect.poll(() => portrait.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(100);

  // The assistant: a free step, then a paid one that waits for a yes.
  await page.goto("/troupe/app/assistant");
  const ask = page.getByRole("textbox", { name: "Ask the assistant" });
  await expect(ask).toBeEnabled({ timeout: 60_000 });
  await ask.fill("Add the OpenRouter video model x-ai/grok-imagine-video to the studio.");
  await ask.press("Enter");
  await expect(page.getByText(/^Added .*Grok/i).first()).toBeVisible({ timeout: 120_000 });
  const send = page.getByRole("button", { name: "Send" });
  const idle = () => expect(page.getByPlaceholder(/Working…/)).toHaveCount(0, { timeout: 240_000 });
  await idle();
  await ask.fill(
    "Render a 1 second 480p 9:16 video shot of the actor Hélène smiling and waving at the camera behind her bakery counter, on Grok Imagine Video, without sound.",
  );
  await ask.press("Enter");
  const confirm = page.getByRole("button", { name: "Confirm", exact: true });
  await expect(confirm).toBeVisible({ timeout: 120_000 });
  await confirm.click();
  await expect(page.getByText(/^Launched 1 render/).first()).toBeVisible({ timeout: 180_000 });
  await idle();

  // The shot finishes in the gallery, downloaded into this browser.
  await page.goto("/troupe/app/shots");
  const video = page.locator("video[src]").first();
  await expect(video).toBeVisible({ timeout: 420_000 });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 60_000 })
    .toBeGreaterThan(0);
  const size = await video.evaluate((v: HTMLVideoElement) => [v.videoWidth, v.videoHeight]);
  expect(size[0]).toBeGreaterThan(0);

  // The script chat answers on OpenRouter in a project.
  await page.goto("/troupe/app/assistant");
  await expect(send).toBeVisible();
  await ask.fill(
    'Create a TikTok project titled "Croissant Friday" with the actor Hélène, and set its script to two lines: "[excited] Fresh croissants every Friday at seven." and "[calm] Come early, they go fast."',
  );
  await ask.press("Enter");
  await expect(page.getByText(/^Saved script version/).first()).toBeVisible({ timeout: 240_000 });
  await idle();
  const project = page.getByRole("link", { name: "Croissant Friday" }).first();
  await project.click();
  const chat = page.getByPlaceholder(/punchier hook|Describe the script/);
  await expect(chat).toBeVisible({ timeout: 60_000 });
  await chat.fill("Make the hook shorter and punchier.");
  await chat.press("Enter");
  await expect(page.getByRole("button", { name: "Apply only" }).first()).toBeVisible({ timeout: 180_000 });

  expect(errors).toEqual([]);
});
