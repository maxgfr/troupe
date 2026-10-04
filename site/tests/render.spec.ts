import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";

// A real render in the browser: Kokoro voices, the shared scene, WebCodecs
// and mediabunny, then playback through the media service worker. Run it
// with `pnpm site:test:render` after `pnpm site:build` (docs/STATIC-SITE.md):
// headed Chrome by default, which voices on the GPU. CI runs it headless in
// Playwright's Chromium (HEADLESS=1 RENDER_CHANNEL=chromium), where it takes
// the CPU path and Opus audio.
//
// The browser profile is kept between runs, so the voice model downloads
// once. RENDER_ARGS passes Chrome flags, e.g. "--disable-gpu
// --disable-features=WebGPU" to try the CPU path on a machine with a GPU.

const APP = "http://localhost:4173/troupe/app";
const PROFILE = join(tmpdir(), "troupe-render-test-profile");
const SCRIPT = "Stop scrolling for a second.\nTry it tonight.";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
const errors: string[] = [];

test.beforeAll(async () => {
  mkdirSync(PROFILE, { recursive: true });
  // Chrome closes a persistent profile after a download when its history
  // still lists one from an earlier run, whose folder Playwright deleted.
  rmSync(join(PROFILE, "Default", "History"), { force: true });
  context = await chromium.launchPersistentContext(PROFILE, {
    channel: process.env.RENDER_CHANNEL ?? "chrome",
    headless: process.env.HEADLESS === "1",
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
    args: (process.env.RENDER_ARGS ?? "").split(" ").filter(Boolean),
  });
  page = context.pages()[0] ?? (await context.newPage());
  watch(page);
});

test.afterAll(async () => {
  await context?.close();
});

// Deep links answer with Pages' 404.html and a 404 status, which the browser
// logs; anything else in the console is a bug.
function watch(target: Page) {
  target.on("pageerror", (error) => errors.push(error.message));
  target.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("status of 404")) errors.push(message.text());
  });
}

async function newProject(title: string): Promise<string> {
  await page.goto(`${APP}/projects/new`);
  await page.getByLabel("Project title").fill(title);
  for (let step = 0; step < 3; step++) await page.getByRole("button", { name: "Continue" }).click();
  await page.locator('label:has(input[name="actor"]:not([disabled]))').first().click();
  await page.getByRole("button", { name: /Create project/ }).click();
  await expect(page).toHaveURL(/\/script$/);
  await page.getByLabel(/Write or paste your script/).fill(SCRIPT);
  await page.getByRole("button", { name: "Save as new version" }).click();
  await expect(page.getByText(/version 1 · origin/)).toBeVisible();
  const projectUrl = page.url().replace(/\/script$/, "");
  await page.goto(projectUrl);
  return projectUrl;
}

async function launchSixSeconds() {
  await expect(page.getByText("Runs in this browser.")).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Clip length").selectOption("6");
  await page.getByRole("button", { name: "Launch draft" }).click();
}

function probe(file: string) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,duration:format=duration", "-of", "json", file], { encoding: "utf8" });
  return JSON.parse(out) as { streams: { codec_type: string; codec_name: string; width?: number; height?: number; duration?: string }[]; format: { duration: string } };
}

test("renders a 6 s clip in the browser, then plays, seeks and downloads it", async () => {
  test.setTimeout(10 * 60_000);
  await newProject("Browser render");
  // The player asks the media service worker for byte ranges as it loads and seeks.
  const mediaStatuses: number[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/troupe/app/media/")) mediaStatuses.push(r.status());
  });
  await launchSixSeconds();

  // Live progress replaces the generic bar while the tab renders.
  await expect(page.getByRole("progressbar", { name: "Render progress" })).toBeVisible();
  const video = page.locator("video");
  await expect(video).toBeVisible({ timeout: 8 * 60_000 });
  await expect(page.getByText("completed", { exact: true })).toBeVisible();

  // The clip is as long as the script, within the 6 s chosen, 720×1280.
  const meta = await video.evaluate(async (v: HTMLVideoElement) => {
    if (v.readyState < 1) await new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true }));
    return { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
  });
  expect(meta.width).toBe(720);
  expect(meta.height).toBe(1280);
  expect(meta.duration).toBeGreaterThan(2);
  expect(meta.duration).toBeLessThanOrEqual(6.2);

  // Seeking: the playhead jumps and plays on.
  const seek = await video.evaluate(async (v: HTMLVideoElement) => {
    v.muted = true;
    const target = v.duration / 2;
    v.currentTime = target;
    await new Promise((r) => v.addEventListener("seeked", r, { once: true }));
    const landed = v.currentTime;
    await v.play();
    await new Promise<void>((resolve) => {
      const tick = () => (v.currentTime > landed + 0.3 ? resolve() : requestAnimationFrame(tick));
      tick();
    });
    v.pause();
    return { target, landed, after: v.currentTime };
  });
  expect(mediaStatuses).toContain(206);
  expect(Math.abs(seek.landed - seek.target)).toBeLessThan(0.1);
  expect(seek.after).toBeGreaterThan(seek.landed);

  // Download: the link saves an MP4 with H.264 video and AAC (or Opus)
  // audio, the same length.
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download MP4" }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("troupe-video.mp4");
  const file = join(test.info().outputDir, "render.mp4");
  await saved.saveAs(file);
  expect(readFileSync(file).subarray(4, 8).toString("ascii")).toBe("ftyp");
  const info = probe(file);
  const videoStream = info.streams.find((s) => s.codec_type === "video");
  const audioStream = info.streams.find((s) => s.codec_type === "audio");
  expect(videoStream).toMatchObject({ codec_name: "h264", width: 720, height: 1280 });
  expect(["aac", "opus"]).toContain(audioStream?.codec_name);
  expect(Math.abs(Number(info.format.duration) - meta.duration)).toBeLessThan(0.1);
  expect(Math.abs(Number(audioStream?.duration) - Number(videoStream?.duration))).toBeLessThan(0.1);
  test.info().annotations.push({ type: "render", description: JSON.stringify({ duration: meta.duration, audio: audioStream?.codec_name }) });

  expect(errors).toEqual([]);
});

test("a render cut short by closing its tab is marked failed on the next load", async () => {
  test.setTimeout(5 * 60_000);
  const projectUrl = await newProject("Interrupted render");
  await launchSixSeconds();
  await expect(page.getByRole("progressbar", { name: "Render progress" })).toBeVisible();

  // Close the tab mid-render, then come back in a new one.
  await page.close();
  page = await context.newPage();
  watch(page);
  await page.goto(projectUrl);
  await expect(page.getByText("failed", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("The tab rendering this video was closed before it finished. Relaunch it.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Relaunch" })).toBeVisible();
  expect(errors).toEqual([]);
});
