import { expect, test } from "@playwright/test";

import { TRIAL_WORD, watchConsole, watchForBrokenStudio } from "./page-checks";

// The browser edition end to end in a real browser: the studio's pages, its
// tRPC router and Postgres (PGlite in IndexedDB) all running in the page.

const APP = "/troupe/app";

// Creating the database from scratch replays every migration: a first visit
// and a reset take seconds on a laptop and far longer on a CI runner.
const MIGRATING = { timeout: 60_000 };

// SITE_CPU_THROTTLE=6 replays the suite with the page's CPU six times slower
// (the PGlite worker keeps its speed).
test.beforeEach(async ({ page }) => {
  const rate = Number(process.env.SITE_CPU_THROTTLE ?? 1);
  if (rate > 1) await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate });
});

test("landing → dashboard → new project → script, kept across reloads and deep links", async ({ page }) => {
  const errors = watchConsole(page);

  await page.goto("/troupe/");
  await page.getByRole("link", { name: "Open Troupe in your browser" }).first().click();
  await expect(page).toHaveURL(/\/troupe\/app\/dashboard$/);
  await expect(page.getByText("Create your first project")).toBeVisible(MIGRATING);
  // The browser edition is Troupe itself, and nothing says otherwise.
  await expect(page.locator("body")).not.toContainText(TRIAL_WORD);

  await page.getByRole("link", { name: "New project" }).first().click();
  await page.getByLabel("Project title").fill("Smoke project");
  await page.getByRole("button", { name: "Continue" }).click();
  // Cloud models need the self-hosted studio: each one says why.
  await expect(page.getByText(/Needs the self-hosted studio, which keeps your API key/).first()).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  const actor = page.locator('label:has(input[name="actor"]:not([disabled]))').first();
  // Every actor has a real picture, served by the site itself.
  const picture = actor.locator("img");
  await expect(picture).toHaveAttribute("src", /^\/troupe\/actors\/[a-z]+-\d{2}\/v1\/front\.webp$/);
  await picture.scrollIntoViewIfNeeded();
  // The copy the browser picked for the tile's width (front-160/320.webp),
  // decoded.
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0 && img.currentSrc)).toMatch(/\/troupe\/actors\/[a-z]+-\d{2}\/v1\/front(-\d+)?\.webp$/);
  await actor.click();
  await page.getByRole("button", { name: /Create project/ }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}\/script$/);

  await page.getByLabel(/Write or paste your script/).fill("Stop scrolling for a second.\nThis studio runs in your browser.\nTry it tonight.");
  await page.getByRole("button", { name: "Save as new version" }).click();
  await expect(page.getByText(/version 1 · written here/)).toBeVisible();

  // Persistence: the script is read back from IndexedDB after a reload.
  await page.reload();
  await expect(page.getByText("This studio runs in your browser.", { exact: true })).toBeVisible();

  // Deep link: a fresh load of a project URL boots the app on that page.
  const projectUrl = page.url().replace(/\/script$/, "");
  await page.goto(projectUrl);
  await expect(page.getByRole("heading", { name: "Smoke project" })).toBeVisible();
  // The in-browser model is offered, or the browser says why it cannot render.
  await expect(page.getByText("Runs in this browser.").or(page.getByText(/This browser cannot render video/))).toBeVisible();
  await page.goto(`${APP}/dashboard`);
  await expect(page.getByRole("link", { name: /Smoke project/ })).toBeVisible();

  expect(errors).toEqual([]);
});

test("the media worker serves stored renders with byte ranges", async ({ page }) => {
  await page.goto(`${APP}/dashboard`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  // A page loaded before the worker took control fetches past it: reload.
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) await page.reload();

  const result = await page.evaluate(async () => {
    // Wait for the start-up clean-up of files no render refers to (these test
    // files have no render): it holds this lock while it runs.
    await navigator.locks.request("troupe-local-data", async () => {});
    const bytes = new Uint8Array(1000).map((_, i) => i % 256);
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("troupe-media", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("files", { keyPath: "id" }).createIndex("storagePath", "storagePath");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction("files", "readwrite");
        tx.objectStore("files").put({ id: "smoke-asset", storagePath: "smoke-asset", blob: new Blob([bytes], { type: "video/mp4" }) });
        // A file that is not a video must never be served as a page.
        tx.objectStore("files").put({ id: "smoke-page", storagePath: "smoke-page", blob: new Blob(["<script>alert(1)</script>"], { type: "text/html" }) });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
    const ranged = await fetch("/troupe/app/media/smoke-asset", { headers: { range: "bytes=100-199" } });
    const body = new Uint8Array(await ranged.arrayBuffer());
    const download = await fetch("/troupe/app/media/smoke-asset?download=1");
    const named = await fetch("/troupe/app/media/smoke-asset?download=smoke-project-kokoro-2026-10-05-0945.mp4");
    const unsafe = await fetch("/troupe/app/media/smoke-asset?download=..%2Fsecret.mp4");
    const missing = await fetch("/troupe/app/media/nothing-here");
    const page = await fetch("/troupe/app/media/smoke-page");
    return {
      status: ranged.status,
      contentRange: ranged.headers.get("content-range"),
      length: body.length,
      first: body[0],
      downloadStatus: download.status,
      disposition: download.headers.get("content-disposition"),
      namedDisposition: named.headers.get("content-disposition"),
      unsafeDisposition: unsafe.headers.get("content-disposition"),
      missing: missing.status,
      pageType: page.headers.get("content-type"),
      pageDisposition: page.headers.get("content-disposition"),
      pageSniffing: page.headers.get("x-content-type-options"),
    };
  });
  expect(result).toEqual({
    status: 206,
    contentRange: "bytes 100-199/1000",
    length: 100,
    first: 100,
    downloadStatus: 200,
    disposition: 'attachment; filename="troupe-video.mp4"',
    // A link names the file it saves; anything but a plain name falls back.
    namedDisposition: 'attachment; filename="smoke-project-kokoro-2026-10-05-0945.mp4"',
    unsafeDisposition: 'attachment; filename="troupe-video.mp4"',
    missing: 404,
    pageType: "application/octet-stream",
    pageDisposition: 'attachment; filename="troupe-file.bin"',
    pageSniffing: "nosniff",
  });
});

test("settings says what needs the self-hosted studio, and deleting all local data empties the studio", async ({ page }) => {
  // The database is created twice here (first visit, then the deletion).
  test.slow();
  const errors = watchConsole(page);
  await page.goto(`${APP}/settings`);
  await expect(page.getByText(/Cloud providers need the self-hosted studio/)).toBeVisible(MIGRATING);
  await expect(page.getByText(/A page served from the web cannot connect to them/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Background checks" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Set up the self-hosted studio", exact: true }).first()).toHaveAttribute("href", /docs\/SELF-HOSTING\.md$/);
  await expect(page.locator("body")).not.toContainText(TRIAL_WORD);

  await page.goto(`${APP}/projects/new`);
  await page.getByLabel("Project title").fill("To be reset");
  for (let step = 0; step < 3; step++) await page.getByRole("button", { name: "Continue" }).click();
  await page.locator('label:has(input[name="actor"]:not([disabled]))').first().click();
  await page.getByRole("button", { name: /Create project/ }).click();
  await expect(page).toHaveURL(/\/script$/);

  // Reset while Postgres is still starting on the freshly loaded page (slowed
  // down here so it always is, as on a slow machine). Pages querying the
  // studio meanwhile must wait for the reset, never see it half-rebuilt.
  await page.route(/pglite-.*\.data$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    await route.continue();
  });
  const glimpses = await watchForBrokenStudio(page);
  await page.goto(`${APP}/settings`);
  await page.getByRole("button", { name: "Delete all local data" }).click();
  await page.getByRole("button", { name: "Delete everything" }).click();
  // The slow start has done its job; let the next page load at full speed and
  // from the HTTP cache again (an active route bypasses it).
  await page.unrouteAll({ behavior: "wait" });
  await expect(page).toHaveURL(/\/troupe\/app\/dashboard$/, MIGRATING);
  // The dashboard is a new page: Postgres starts there again.
  await expect(page.getByText("Create your first project")).toBeVisible(MIGRATING);
  expect(glimpses).toEqual([]);
  expect(errors).toEqual([]);
});

test("exports all local data, deletes it, and imports it back", async ({ page }) => {
  // The database is created twice here (first visit, then the deletion).
  test.slow();
  const errors = watchConsole(page);
  await page.goto(`${APP}/projects/new`);
  await page.getByLabel("Project title").fill("Backed up");
  for (let step = 0; step < 3; step++) await page.getByRole("button", { name: "Continue" }).click();
  await page.locator('label:has(input[name="actor"]:not([disabled]))').first().click();
  await page.getByRole("button", { name: /Create project/ }).click();
  await expect(page).toHaveURL(/\/script$/, MIGRATING);
  const scriptUrl = page.url();
  await page.getByLabel(/Write or paste your script/).fill("Kept in the backup.\nRead back after the import.");
  await page.getByRole("button", { name: "Save as new version" }).click();
  await expect(page.getByText(/version 1 · written here/)).toBeVisible();

  await page.goto(`${APP}/settings`);
  await expect(page.getByText(/used, of about/)).toBeVisible(MIGRATING);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export data" }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toMatch(/^troupe-backup-\d{4}-\d{2}-\d{2}-\d{4}\.tar$/);
  const backup = test.info().outputPath("backup.tar");
  await saved.saveAs(backup);

  await page.getByRole("button", { name: "Delete all local data" }).click();
  await page.getByRole("button", { name: "Delete everything" }).click();
  await expect(page).toHaveURL(/\/troupe\/app\/dashboard$/, MIGRATING);
  await expect(page.getByText("Create your first project")).toBeVisible(MIGRATING);

  await page.goto(`${APP}/settings`);
  await page.getByLabel("Backup file to import").setInputFiles(backup);
  await expect(page.getByRole("alertdialog")).toContainText(/It holds 1 project, saved/, MIGRATING);
  await page.getByRole("button", { name: "Replace with backup" }).click();
  await expect(page).toHaveURL(/\/troupe\/app\/dashboard$/, MIGRATING);
  await expect(page.getByRole("link", { name: /Backed up/ })).toBeVisible(MIGRATING);
  await page.goto(scriptUrl);
  await expect(page.getByText("Read back after the import.", { exact: true })).toBeVisible(MIGRATING);
  expect(errors).toEqual([]);
});

test("an unknown app path shows the studio's not-found page", async ({ page }) => {
  await page.goto(`${APP}/no-such-page`);
  await expect(page.getByText("Nothing at this address")).toBeVisible();
  await page.getByRole("link", { name: "Back to your projects" }).click();
  await expect(page).toHaveURL(/\/troupe\/app\/dashboard$/);
});
