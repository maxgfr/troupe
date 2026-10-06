import { expect, test } from "@playwright/test";

import { TRIAL_WORD } from "./page-checks";

// The landing page at /troupe/: what it says, the presentation video, the
// step list's jumps into it, the quick start's copy button, and every link
// that stays on the site.

const LANDING = "/troupe/";

test("says what Troupe is, opens the browser edition, and presents it as Troupe itself", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(LANDING);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("A video studio that runs in your browser.");
  await expect(page.locator("body")).not.toContainText(TRIAL_WORD);
  // The cast, from the catalog, with the pictures the site serves.
  await expect(page.locator(".cast__grid img")).toHaveCount(30);
  // Small copies for the grid, the full picture for wide high-density screens.
  await expect(page.locator(".cast__grid img").first()).toHaveAttribute(
    "srcset",
    /front-160\.webp 160w, .*front-320\.webp 320w, .*front\.webp 768w$/,
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /^https:\/\/.+\/social\.png$/);
  await page.getByRole("link", { name: "Open Troupe in your browser" }).first().click();
  await expect(page).toHaveURL(/\/troupe\/app\/dashboard$/);
  expect(errors).toEqual([]);
});

test("the video plays from its poster, and each step jumps to its chapter", async ({ page }) => {
  await page.goto(LANDING);
  const video = page.locator("#watch video");
  // Playwright's Chromium has no H.264: it plays the WebM, Chrome the first it can.
  await page.getByRole("button", { name: "Play the video" }).click();
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 20_000 })
    .toBeGreaterThan(0.5);
  expect(await video.evaluate((v: HTMLVideoElement) => v.controls)).toBe(true);
  const meta = await video.evaluate((v: HTMLVideoElement) => ({
    duration: v.duration,
    width: v.videoWidth,
    src: v.currentSrc,
  }));
  expect(meta.duration).toBeGreaterThanOrEqual(45);
  expect(meta.duration).toBeLessThanOrEqual(61);
  expect(meta.width).toBe(1920);
  // What the actor says has a captions track (the rest of the video is silent).
  const cues = await video.evaluate(async (v: HTMLVideoElement) => {
    const track = v.textTracks[0]!;
    track.mode = "hidden";
    const el = v.querySelector("track")!;
    if (el.readyState !== 2) await new Promise((r) => el.addEventListener("load", r, { once: true }));
    return { kind: track.kind, cues: [...track.cues!].map((c) => (c as VTTCue).text) };
  });
  expect(cues.kind).toBe("captions");
  expect(cues.cues.length).toBeGreaterThan(0);

  const chat = page.locator('button[data-seek="chat"]');
  await expect(chat).toBeVisible();
  const label = (await chat.locator(".cue__time").innerText()).trim();
  expect(label).toMatch(/^\d+:\d{2}$/);
  // The name starts with what the button shows (WCAG 2.5.3), then says where it goes.
  await expect(chat).toHaveAccessibleName(`${label} Watch: Ask the chat for a punchier hook`);
  await expect(page.locator('button[data-seek="render"]')).toHaveAccessibleName(
    /^\d+:\d{2} Watch: Kokoro voices it, WebCodecs encodes it$/,
  );
  await chat.click();
  const [m, s] = label.split(":").map(Number);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThanOrEqual(m! * 60 + s!);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeLessThan(m! * 60 + s! + 5);
});

test("both video files are there, small enough, and of the right kind", async ({ page, request }) => {
  await page.goto(LANDING);
  const sources = await page
    .locator("#watch video source")
    .evaluateAll((list) =>
      list.map((s) => ({ src: (s as HTMLSourceElement).src, type: (s as HTMLSourceElement).type })),
    );
  expect(sources.map((s) => s.type)).toEqual(["video/webm", "video/mp4"]);
  // Under the site's base, as the build rewrote them.
  expect(sources.map((s) => new URL(s.src).pathname)).toEqual([
    "/troupe/tour/troupe-tour.webm",
    "/troupe/tour/troupe-tour.mp4",
  ]);
  for (const { src } of sources) {
    const response = await request.get(src);
    expect(response.status(), src).toBe(200);
    const body = await response.body();
    expect(body.length, src).toBeLessThanOrEqual(8 * 1024 * 1024);
    // WebM starts with the EBML magic number, MP4 with an ftyp box.
    if (src.endsWith(".webm")) expect(body.subarray(0, 4).toString("hex")).toBe("1a45dfa3");
    else expect(body.subarray(4, 8).toString("ascii")).toBe("ftyp");
  }
  // The WebM plays here; the MP4 wherever the browser has H.264.
  const playable = await page.evaluate(
    async (urls) => {
      const out: Record<string, number | string> = {};
      for (const url of urls) {
        const v = document.createElement("video");
        v.muted = true;
        if (
          !v.canPlayType(
            url.endsWith(".mp4") ? 'video/mp4; codecs="avc1.640028, mp4a.40.2"' : 'video/webm; codecs="vp9, opus"',
          )
        ) {
          out[url] = "unsupported";
          continue;
        }
        v.src = url;
        await v.play();
        await new Promise<void>((resolve) => {
          const tick = () => (v.currentTime > 0.3 ? resolve() : requestAnimationFrame(tick));
          tick();
        });
        v.pause();
        out[url] = v.duration;
      }
      return out;
    },
    sources.map((s) => s.src),
  );
  const webm = playable[sources[0]!.src];
  expect(typeof webm === "number" && webm > 45).toBe(true);
});

test("the quick start copies its commands", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`${LANDING}#self-host`);
  await page.getByRole("button", { name: "Copy" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/^git clone https:\/\/.+\.git && cd troupe\ndocker compose up -d --wait$/);
});

test("every link and file the landing page points at on this site exists", async ({ page, request }) => {
  await page.goto(LANDING);
  const urls = await page.evaluate(() => {
    const found = new Set<string>();
    for (const el of document.querySelectorAll("[href], [src], [poster], [content]")) {
      for (const attr of ["href", "src", "poster", "content"]) {
        const value = el.getAttribute(attr);
        if (!value || value.startsWith("#") || (attr === "content" && !/^https?:|^\//.test(value))) continue;
        const url = new URL(value, document.baseURI);
        if (url.origin === location.origin) found.add(url.pathname);
      }
    }
    return [...found];
  });
  expect(urls.length).toBeGreaterThan(30);
  for (const url of urls) {
    const response = await request.get(url);
    expect(response.status(), url).toBe(200);
  }
  // Same-page anchors land on something.
  const anchors = await page
    .locator('a[href^="#"]')
    .evaluateAll((list) => list.map((a) => a.getAttribute("href")!.slice(1)));
  for (const id of anchors) expect(await page.locator(`[id="${id}"]`).count(), id).toBe(1);
});

test("the steps quote the take the video shows", async ({ page, request }) => {
  // The video's captions track holds the lines it renders, in order.
  const vtt = await (await request.get("/troupe/tour/troupe-tour-captions.vtt")).text();
  const lines = vtt
    .split(/\n\n+/)
    .slice(1)
    .map((cue) => cue.split("\n").slice(1).join(" ").trim())
    .filter(Boolean);
  expect(lines).toHaveLength(3);
  await page.goto(LANDING);
  const proposal = page.locator('[data-chapter="chat"] .diff > li');
  await expect(proposal).toHaveCount(3);
  for (const [i, line] of lines.entries()) await expect(proposal.nth(i).locator("p").first()).toHaveText(line);
  // The lines the chat kept are the script's own.
  const script = page.locator('[data-chapter="script"] .artifact--script > li');
  for (const i of [1, 2]) await expect(script.nth(i)).toContainText(lines[i]!);
});
