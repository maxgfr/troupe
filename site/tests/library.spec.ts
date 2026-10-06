import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

// The inspiration library in the browser edition: a video uploaded from this
// computer is kept in the browser, its pictures taken in the page, its
// speech transcribed by Whisper in a worker, its passages indexed by a
// sentence-embedding model, and searched by meaning. The models download
// from the Hugging Face Hub on the first run (about 200 MB), then come from
// the browser's cache. The library chat needs WebGPU: tests/chat.spec.ts.

const APP = "/troupe/app";
const CLIP = fileURLToPath(new URL("fixtures/library-clip.mp4", import.meta.url));
// The first run downloads the models; a CI runner's CPU is slow too.
const ANALYSIS = { timeout: 8 * 60_000 };
// A fresh browser profile starts the studio's database and runs every
// migration before the page knows its workspace: 25 s on one loaded CPU,
// as long as smoke.spec.ts allows. The heading shows before that.
const FIRST_BOOT = { timeout: 60_000 };

test.setTimeout(12 * 60_000);

function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("status of 404")) errors.push(message.text());
  });
  return errors;
}

test("upload a video → pictures, transcript and hook in the page → search by meaning → delete", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto(`${APP}/library`);
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible({ timeout: 60_000 });
  // Links need a server; the page says so instead of offering them.
  await expect(page.getByPlaceholder("Paste a text, or upload a file")).toBeVisible(FIRST_BOOT);
  await expect(page.getByText(/Everything stays in this browser/)).toBeVisible();
  // What cannot run here says so: pictures need a vision model, links a server.
  const tools = page.getByRole("button", { expanded: false }).filter({ hasText: "not ready" });
  await expect(tools).toContainText("Pictures (not ready)");
  await expect(tools).toContainText("Links (not ready)");
  await tools.click();
  await expect(page.getByText(/describing them needs a vision model/)).toBeVisible();
  // A pasted link is refused with the way round it, and nothing is saved.
  await page.getByLabel("A text to save").fill("https://www.youtube.com/watch?v=eRsGyueVLvQ");
  await page.getByRole("button", { name: "Save link" }).click();
  await expect(page.getByRole("alert")).toContainText("A page in your browser cannot fetch other sites");
  await expect(page.getByText("Save your first piece")).toBeVisible();
  await page.getByLabel("A text to save").fill("");

  await page.locator('input[type="file"]').setInputFiles(CLIP);
  const row = page.locator("table").getByRole("row", { name: /library clip/i });
  await expect(row).toBeVisible();
  await expect(row.getByText("ready")).toBeVisible(ANALYSIS);

  await row.getByRole("link", { name: /library clip/i }).click();
  await expect(page.getByRole("heading", { level: 1, name: /library clip/i })).toBeVisible();
  // Whisper heard the actor; the hook is the opening phrase.
  await expect(page.getByRole("region", { name: "Transcript" }).or(page.locator("section", { hasText: "Transcript" })).first()).toContainText(/cold brew/i);
  await expect(page.locator("blockquote")).toContainText(/stop buying cold brew/i);
  // Pictures were taken from the video and placed on the timeline.
  const pictures = page.getByRole("list", { name: "Pictures" }).getByRole("button");
  expect(await pictures.count()).toBeGreaterThan(0);
  await expect(pictures.first().locator("img")).toHaveJSProperty("complete", true);
  expect(await pictures.first().locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  // The video plays from the browser's own storage.
  const duration = await page.locator("video").evaluate(async (v: HTMLVideoElement) => {
    if (v.readyState < 1) await new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true }));
    return v.duration;
  });
  expect(duration).toBeGreaterThan(10);
  // Without WebGPU (this headless browser) the ideas say why they cannot be written.
  const ideas = page.getByRole("button", { name: "5 ideas in this style" });
  if (await ideas.isDisabled()) await expect(page.getByText(/Ideas are written by the chat model, which cannot run/)).toBeVisible();

  await page.getByRole("link", { name: "← Library" }).click();
  await page.getByLabel("Search your library").fill("how to make coffee in the fridge");
  await expect(page.getByText(/closest in meaning first/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("link", { name: /library clip/i }).first()).toBeVisible();

  await page.getByLabel("Search your library").fill("");
  await page.locator("table").getByRole("link", { name: /library clip/i }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete it and its files" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByText("Save your first piece")).toBeVisible();
  expect(errors).toEqual([]);
});
