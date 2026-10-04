import { expect, test, type Page } from "@playwright/test";

// The demo end to end in a real browser: the studio's pages, its tRPC router
// and Postgres (PGlite in IndexedDB) all running in the page.

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

// GitHub Pages answers a deep link with 404.html (the app) and a 404 status;
// the browser logs that status. Anything else in the console is a bug.
function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("status of 404")) errors.push(message.text());
  });
  return errors;
}

test("landing → dashboard → new project → script, kept across reloads and deep links", async ({ page }) => {
  const errors = watchConsole(page);

  await page.goto("/troupe/");
  await page.getByRole("link", { name: "Open the app" }).click();
  await expect(page).toHaveURL(/\/troupe\/app\/dashboard$/);
  await expect(page.getByText("Browser demo.")).toBeVisible();
  await expect(page.getByText("Create your first project")).toBeVisible(MIGRATING);

  await page.getByRole("link", { name: "New project" }).first().click();
  await page.getByLabel("Project title").fill("Smoke project");
  await page.getByRole("button", { name: "Continue" }).click();
  // Cloud models cannot run in the demo: each one says why.
  await expect(page.getByText(/Not available in the browser demo/).first()).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator('label:has(input[name="actor"]:not([disabled]))').first().click();
  await page.getByRole("button", { name: /Create project/ }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}\/script$/);

  await page.getByLabel(/Write or paste your script/).fill("Stop scrolling for a second.\nThis studio runs in your browser.\nTry it tonight.");
  await page.getByRole("button", { name: "Save as new version" }).click();
  await expect(page.getByText(/version 1 · origin/)).toBeVisible();

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
    const bytes = new Uint8Array(1000).map((_, i) => i % 256);
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("troupe-media", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("files", { keyPath: "id" }).createIndex("storagePath", "storagePath");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction("files", "readwrite");
        tx.objectStore("files").put({ id: "smoke-asset", storagePath: "smoke-asset", blob: new Blob([bytes], { type: "video/mp4" }) });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
    const ranged = await fetch("/troupe/app/media/smoke-asset", { headers: { range: "bytes=100-199" } });
    const body = new Uint8Array(await ranged.arrayBuffer());
    const download = await fetch("/troupe/app/media/smoke-asset?download=1");
    const missing = await fetch("/troupe/app/media/nothing-here");
    return {
      status: ranged.status,
      contentRange: ranged.headers.get("content-range"),
      length: body.length,
      first: body[0],
      downloadStatus: download.status,
      disposition: download.headers.get("content-disposition"),
      missing: missing.status,
    };
  });
  expect(result).toEqual({
    status: 206,
    contentRange: "bytes 100-199/1000",
    length: 100,
    first: 100,
    downloadStatus: 200,
    disposition: 'attachment; filename="troupe-video.mp4"',
    missing: 404,
  });
});

test("settings says what the demo cannot do, and reset empties the studio", async ({ page }) => {
  // The database is created twice here (first visit, then the reset).
  test.slow();
  const errors = watchConsole(page);
  await page.goto(`${APP}/settings`);
  await expect(page.getByText(/Cloud providers need the self-hosted studio/)).toBeVisible(MIGRATING);
  await expect(page.getByText(/A page served from the web cannot connect to them/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Background checks" })).toHaveCount(0);

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
  const glimpses: string[] = [];
  await page.exposeBinding("reportGlimpse", (_source, text: string) => glimpses.push(text));
  await page.addInitScript(() => {
    new MutationObserver(() => {
      const text = document.querySelector("main")?.textContent ?? "";
      if (/could not (load|be initialized)/.test(text)) (window as unknown as { reportGlimpse: (t: string) => void }).reportGlimpse(text.slice(0, 120));
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  await page.goto(`${APP}/settings`);
  await page.getByRole("button", { name: "Reset demo data" }).click();
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

test("an unknown app path shows the studio's not-found page", async ({ page }) => {
  await page.goto(`${APP}/no-such-page`);
  await expect(page.getByText("Nothing at this address")).toBeVisible();
  await page.getByRole("link", { name: "Back to the dashboard" }).click();
  await expect(page).toHaveURL(/\/troupe\/app\/dashboard$/);
});
