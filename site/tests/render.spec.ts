import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";

import { buildScene } from "../../src/modules/scene";

// A real render in the browser: Kokoro voices, the shared scene, WebCodecs
// and mediabunny, then playback through the media service worker. Run it
// with `pnpm site:test:render` after `pnpm site:build` (docs/BROWSER-EDITION.md):
// headed Chrome by default, which voices on the GPU. CI runs it headless in
// Playwright's Chromium (HEADLESS=1 RENDER_CHANNEL=chromium), where it takes
// the CPU path and Opus audio.
//
// The browser profile is kept between runs (RENDER_PROFILE, default in the
// OS temp folder), so the voice model downloads once. RENDER_ARGS passes Chrome flags, e.g. "--disable-gpu
// --disable-features=WebGPU" to try the CPU path on a machine with a GPU.

// The preview's address comes from the Playwright config (SITE_PORT).
const APP = "/troupe/app";
// RENDER_PROFILE moves it, e.g. where CI caches it.
const PROFILE = process.env.RENDER_PROFILE ?? join(tmpdir(), "troupe-render-test-profile");
const SCRIPT = "Stop scrolling for a second.\nTry it tonight.";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let actorPicture = "";
let renderedProject = "";
const errors: string[] = [];

// biome-ignore lint/correctness/noEmptyPattern: Playwright wants the fixtures argument destructured, and this hook uses none.
test.beforeAll(async ({}, testInfo) => {
  mkdirSync(PROFILE, { recursive: true });
  // Chrome closes a persistent profile after a download when its history
  // still lists one from an earlier run, whose folder Playwright deleted.
  rmSync(join(PROFILE, "Default", "History"), { force: true });
  context = await chromium.launchPersistentContext(PROFILE, {
    channel: process.env.RENDER_CHANNEL ?? "chrome",
    headless: process.env.HEADLESS === "1",
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
    baseURL: testInfo.project.use.baseURL,
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
  const actor = page.locator('label:has(input[name="actor"]:not([disabled]))').first();
  // The actor's picture, as the site serves it: /troupe/actors/<slug>/v1/front.webp.
  actorPicture = (await actor.locator("img").getAttribute("src")) ?? "";
  await actor.click();
  await page.getByRole("button", { name: /Create project/ }).click();
  await expect(page).toHaveURL(/\/script$/);
  await page.getByLabel(/Write or paste your script/).fill(SCRIPT);
  await page.getByRole("button", { name: "Save as new version" }).click();
  await expect(page.getByText(/version 1 · written here/)).toBeVisible();
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
  renderedProject = await newProject("Browser render");
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
  // Named after the project, the model and the time of the render.
  expect(saved.suggestedFilename()).toMatch(/^browser-render-kokoro-voice-captions-\d{4}-\d{2}-\d{2}-\d{4}\.mp4$/);
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

  // The actor card shows the actor's picture: the middle of the card's circle
  // matches the middle of the front picture scaled to the circle's size.
  const { portrait } = buildScene({ width: 720, height: 1280, actor: { id: "x", name: "x" }, lines: [{ role: "hook", text: "x", emotion: "neutral" }] }).layout;
  const side = Math.round(2 * portrait.r);
  const patch = 16;
  const mean = (args: string[]) => {
    const rgb = execFileSync("ffmpeg", ["-v", "error", ...args, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    return [0, 1, 2].map((c) => rgb.filter((_, i) => i % 3 === c).reduce((a, b) => a + b, 0) / (rgb.length / 3));
  };
  const centre = (x: number) => Math.round(x - patch / 2);
  const inVideo = mean(["-ss", "0.1", "-i", file, "-vf", `crop=${patch}:${patch}:${centre(portrait.cx)}:${centre(portrait.cy)}`]);
  expect(actorPicture).toMatch(/^\/troupe\/actors\/[a-z]+-\d{2}\/v1\/front\.webp$/);
  const source = join(import.meta.dirname, "..", "..", "public", actorPicture.replace(/^\/troupe\//, ""));
  const inPicture = mean(["-i", source, "-vf", `scale=${side}:${side},crop=${patch}:${patch}:${centre(side / 2)}:${centre(side / 2)}`]);
  for (const [i, channel] of inVideo.entries()) expect(Math.abs(channel - inPicture[i]!), `channel ${i}: ${inVideo} vs ${inPicture}`).toBeLessThan(20);

  // Once the render is stored, its job (and its copy of the MP4) is forgotten.
  const jobsLeft = () =>
    page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const open = indexedDB.open("troupe-render", 1);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const count = open.result.transaction("jobs").objectStore("jobs").count();
            count.onsuccess = () => {
              resolve(count.result);
              open.result.close();
            };
          };
        }),
    );
  await expect.poll(jobsLeft).toBe(0);

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

// A backup carries the renders: after deleting everything and importing it,
// the video of the first test plays again, from the media service worker.
test("a render survives export, deleting all local data and import", async () => {
  test.setTimeout(5 * 60_000);
  expect(renderedProject).not.toBe("");
  await page.goto(`${APP}/settings`);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export data" }).click();
  const backup = test.info().outputPath("backup.tar");
  await (await download).saveAs(backup);
  // The archive lists its contents with any tar tool.
  const listed = execFileSync("tar", ["-tf", backup], { encoding: "utf8" }).trim().split("\n");
  expect(listed[0]).toBe("troupe-backup.json");
  expect(listed.filter((name) => name.startsWith("media/")).length).toBeGreaterThan(0);

  // While the tables are rebuilt, the studio must never look broken: queries
  // already on their way are asked again afterwards (site/src/rebuild-link.ts).
  const glimpses: string[] = [];
  await page.exposeFunction("reportGlimpse", (text: string) => glimpses.push(text));
  await page.evaluate(() => {
    new MutationObserver(() => {
      const text = document.querySelector("main")?.textContent ?? "";
      if (/could not (load|be initialized)/.test(text)) (window as unknown as { reportGlimpse: (t: string) => void }).reportGlimpse(text.slice(0, 120));
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  await page.getByRole("button", { name: "Delete all local data" }).click();
  await page.getByRole("button", { name: "Delete everything" }).click();
  // Two steps, as the app takes them: the deletion ends by opening the
  // dashboard, where Postgres then starts again.
  await expect(page).toHaveURL(/\/troupe\/app\/dashboard$/, { timeout: 60_000 });
  await expect(page.getByText("Create your first project")).toBeVisible({ timeout: 60_000 });
  expect(glimpses).toEqual([]);

  await page.goto(`${APP}/settings`);
  await page.getByLabel("Backup file to import").setInputFiles(backup);
  await expect(page.getByRole("alertdialog")).toContainText(/projects? and \d+ videos?/, { timeout: 60_000 });
  await page.getByRole("button", { name: "Replace with backup" }).click();
  await expect(page).toHaveURL(/\/troupe\/app\/dashboard$/, { timeout: 60_000 });

  await page.goto(renderedProject);
  const video = page.locator("video");
  await expect(video).toBeVisible({ timeout: 60_000 });
  const played = await video.evaluate(async (v: HTMLVideoElement) => {
    v.muted = true;
    if (v.readyState < 1) await new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true }));
    await v.play();
    await new Promise<void>((resolve) => {
      const tick = () => (v.currentTime > 0.5 ? resolve() : requestAnimationFrame(tick));
      tick();
    });
    v.pause();
    return { duration: v.duration, width: v.videoWidth, at: v.currentTime };
  });
  expect(played.width).toBe(720);
  expect(played.duration).toBeGreaterThan(2);
  expect(played.at).toBeGreaterThan(0.5);
  expect(errors).toEqual([]);
});
