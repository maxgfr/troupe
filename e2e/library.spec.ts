import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type Locator, type Page, test } from "@playwright/test";

import { troupe } from "./stack";

// The inspiration library in the Docker stack, as a person meets it: a video
// uploaded from this computer, an article and a video saved from links, read
// by the stack's own models (Whisper tiny on the renderer, all-minilm and
// the chat model on Ollama), searched by meaning, asked about with
// citations, then an idea made into a project, rendered and played. Then the
// same library through the stack's CLI container.

const CODE = process.env.E2E_ACCESS_CODE ?? "";
const CLIP = readFileSync(new URL("../site/tests/fixtures/library-clip.mp4", import.meta.url));
const ARTICLE = `<!doctype html><html><head><title>Three hooks that work | Field notes</title><meta property="og:site_name" content="Field notes"></head>
<body><nav>Home · Archive · About</nav><article><h1>Three hooks that work</h1>
<p>${"Open on the problem your viewer has this morning, in their own words, before you say anything about yourself. ".repeat(3)}</p>
<p>${"Show the result first, then the method: the payoff in the first second earns the next ten. ".repeat(3)}</p>
<p>${"Ask a question the viewer cannot answer yet, and answer it in the last line, never earlier. ".repeat(3)}</p></article></body></html>`;
// Readings take minutes on a CI runner's CPU.
const READING = { timeout: 15 * 60_000 };
// The test stack stops a writing request after TROUPE_LIBRARY_WRITE_TIMEOUT_S
// (240 s, docker-compose.test.yml) and says so: every ask settles by then.
const WRITING = { timeout: (240 + 60) * 1000 };
// What the model's slowness or slips look like on the page: the loops below
// ask again, as a person would, and the tRPC logger prints them too.
const ASK_AGAIN = /did not write usable scripts|took longer than \d+ s to (answer|write the ideas)/;

test.describe.configure({ mode: "serial" });

// A web server on this computer, reached by the app container at
// host.docker.internal (docker-compose.yml maps it; docker-compose.test.yml
// lets the library fetch from it).
let server: Server;
let origin = "";
test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/notes/hooks") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(ARTICLE);
    } else if (req.url === "/media/cold-brew.mp4") {
      res.writeHead(200, { "content-type": "video/mp4", "content-length": CLIP.length });
      res.end(CLIP);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
  origin = `http://host.docker.internal:${(server.address() as AddressInfo).port}`;
});
test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function signIn(page: Page) {
  expect(CODE, "E2E_ACCESS_CODE: run through pnpm e2e:docker").not.toBe("");
  await page.goto("/access");
  await page.getByLabel("Access code").fill(CODE);
  await page.getByRole("button", { name: "Open studio" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
}

const row = (page: Page, title: RegExp): Locator => page.locator("table").getByRole("row", { name: title }).first();

test("upload a video, save an article and a video from links, search, ask, make an idea a project, render it and play it", async ({ page }, testInfo) => {
  // CI's docker-e2e job has 60 minutes for everything (images, the other
  // projects: about 15): this flow gets 30, two tries per model loop of at
  // most 5 minutes each, and ends with its annotations before the job does.
  test.setTimeout(30 * 60_000);
  const errors = watchConsole(page);
  const shot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`);
    await page.screenshot({ path, fullPage: true });
    await testInfo.attach(name, { path, contentType: "image/png" });
  };
  await signIn(page);
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Library" }).click();
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  await expect(page.getByText("Save your first piece")).toBeVisible();

  // A video from this computer.
  await page.locator('input[type="file"]').setInputFiles({ name: "cold-brew-trick.mp4", mimeType: "video/mp4", buffer: CLIP });
  await expect(row(page, /cold brew trick/i).getByText("ready")).toBeVisible(READING);

  // An article and a video from links.
  await page.getByLabel("A link or a text to save").fill(`${origin}/notes/hooks`);
  await page.getByRole("button", { name: "Save link" }).click();
  await expect(row(page, /Three hooks that work/).getByText("ready")).toBeVisible(READING);
  await page.getByLabel("A link or a text to save").fill(`${origin}/media/cold-brew.mp4`);
  await page.getByRole("button", { name: "Save link" }).click();
  await expect(row(page, /^cold-brew /).getByText("ready")).toBeVisible(READING);
  await shot("01-library");

  // The uploaded video, read: transcript, pictures, hook.
  await row(page, /cold brew trick/i).getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1, name: "cold brew trick" })).toBeVisible();
  await expect(page.locator("section", { hasText: "Transcript" }).last()).toContainText(/brew/i);
  await expect(page.locator("blockquote")).toBeVisible();
  expect(await page.getByRole("list", { name: "Pictures" }).getByRole("button").count()).toBeGreaterThan(0);
  const frame = page.getByRole("list", { name: "Pictures" }).locator("img").first();
  await expect.poll(() => frame.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  await shot("02-item");

  // The article, read.
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Library" }).click();
  await row(page, /Three hooks that work/).getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1, name: "Three hooks that work" })).toBeVisible();
  await expect(page.getByText("Ask a question the viewer cannot answer yet").first()).toBeVisible();
  await expect(page.getByText("Home · Archive · About")).toHaveCount(0);
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Library" }).click();

  // Search by meaning.
  await page.getByLabel("Search your library").fill("making coffee in the fridge overnight");
  await expect(page.getByText(/closest in meaning first/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("link", { name: /cold brew/i }).first()).toBeVisible();
  await page.getByLabel("Search your library").fill("");

  // Ask the library: the answer cites what it used. The test stack's 0.5B
  // model sometimes answers without citing; a person asks again, and the
  // report says how many asks it took.
  const chat = page.getByRole("complementary", { name: "Ask your library" });
  const sources = chat.getByRole("list", { name: "Sources" });
  const answers = chat.getByRole("article", { name: "Answer" });
  const asked: string[] = [];
  while (asked.length < 2 && (await sources.count()) === 0) {
    const before = await answers.count();
    await chat.getByLabel("Ask your library").fill("Which saved piece talks about cold brew, and how does it open?");
    await chat.getByRole("button", { name: "Ask" }).click();
    // Settled: an answer, or the reason there is none (the server's time limit).
    await expect(answers.nth(before).or(chat.getByRole("alert"))).toBeVisible(WRITING);
    const alert = chat.getByRole("alert");
    asked.push((await alert.isVisible()) ? `stopped: ${await alert.innerText()}` : (await sources.count()) > 0 ? "cited" : "no citation");
  }
  testInfo.annotations.push({ type: "library chat asks", description: asked.join(" | ") });
  expect(await sources.count(), `no answer cited a source in ${asked.length} asks: ${asked.join(" | ")}`).toBeGreaterThan(0);
  // A citation opens the item it cites.
  await expect(sources.first().getByRole("link").first()).toHaveAttribute("href", /\/library\/[0-9a-f-]{36}/);
  await shot("03-chat");

  // Ideas in the style of the video; one short enough for the stack's
  // renderer (15 s at most) made into a project. The 0.5B model sometimes
  // writes none, or only long ones: a person asks again, and the report says
  // how many tries it took and, when none fits, every length it wrote.
  await page.locator("table").getByRole("link", { name: /cold brew trick/i }).click();
  // The stack writes three at a time (TROUPE_LIBRARY_IDEAS).
  const write = page.getByRole("button", { name: "3 ideas in this style" });
  const cards = page.locator("li").filter({ has: page.getByRole("button", { name: "Create project" }) });
  const fitting = cards.filter({ hasText: /about ([1-9]|1[0-5]) s/ }).getByRole("button", { name: "Create project" });
  const tried: string[] = [];
  while (tried.length < 2 && (await fitting.count()) === 0) {
    const before = await cards.count();
    await write.click();
    await expect(page.getByRole("button", { name: "Writing 3 ideas…" })).toBeVisible();
    // Settled: the button is back once the server has answered, with ideas
    // or with the reason it stopped, within its time limit.
    await expect(write).toBeEnabled(WRITING);
    const alert = page.getByRole("alert").filter({ hasText: ASK_AGAIN });
    tried.push((await alert.isVisible()) ? `stopped: ${await alert.innerText()}` : `${(await cards.count()) - before} ideas`);
  }
  testInfo.annotations.push({ type: "library ideas tries", description: tried.join(" | ") });
  const lengths = (await cards.allInnerTexts()).map((text) => /about (\d+) s/.exec(text)?.[1] ?? "?");
  expect(await fitting.count(), `no idea of 15 s or less in ${tried.length} tries (${tried.join(" | ")}); lengths written: ${lengths.join(", ") || "none"}`).toBeGreaterThan(0);
  await shot("04-ideas");
  await fitting.first().click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);

  // It renders on the stack's renderer, and plays.
  const launch = page.getByRole("button", { name: "Launch draft" });
  await expect(launch).toBeEnabled();
  await launch.click();
  const video = page.locator("video").first();
  await expect(page.getByText("completed", { exact: true }).first()).toBeVisible({ timeout: 10 * 60_000 });
  const played = await video.evaluate(async (v: HTMLVideoElement) => {
    if (v.readyState < 1) await new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true }));
    v.muted = true;
    await v.play();
    await new Promise((r) => setTimeout(r, 1500));
    v.pause();
    return { duration: v.duration, at: v.currentTime };
  });
  expect(played.duration).toBeGreaterThan(2);
  expect(played.at).toBeGreaterThan(0.5);
  await shot("05-rendered");
  // The tRPC logger also prints the errors the page shows when the 0.5B
  // model slips or runs out of time, which the loops above ask again for.
  expect(errors.filter((error) => !ASK_AGAIN.test(error))).toEqual([]);
});

test("the CLI saves, lists, searches, asks and writes ideas, and doctor checks the library's tools", () => {
  const json = (args: string[]) => {
    const run = troupe("--json", ...args);
    expect(run.code, `troupe ${args.join(" ")}: ${run.stderr || run.stdout}`).toBe(0);
    return JSON.parse(run.stdout);
  };
  const doctor = json(["doctor", "--skip-tests"]) as { checks: { name: string; status: string }[] };
  expect(Object.fromEntries(doctor.checks.filter((c) => c.name.startsWith("library ")).map((c) => [c.name, c.status]))).toMatchObject({
    "library transcription": "ok",
    "library embeddings": "ok",
    "library writer": "ok",
    "library links": "ok",
    "library video-links": "ok",
  });

  execFileSync("sh", ["-c", `printf 'Stop scrolling: this jacket packs into its own pocket.\\nFollow for the next test.\\n' > "${process.env.E2E_CACHE_DIR ?? ".cache/e2e"}/cli/note.txt"`]);
  const saved = json(["library", "add", "/work/note.txt", "--mine", "--wait", "--timeout", "600"]);
  expect(saved).toMatchObject({ kind: "text", mine: true, status: "ready" });
  const listed = json(["library", "list"]) as { title: string }[];
  expect(listed.length).toBeGreaterThanOrEqual(4);
  const found = json(["library", "search", "a", "jacket", "that", "folds", "into", "a", "pocket"]);
  expect(found.mode).toBe("semantic");
  expect(found.hits[0].itemId).toBe(saved.id);
  const shown = json(["library", "show", saved.id.slice(0, 8)]);
  expect(shown.analysis.hook.text).toContain("Stop scrolling");
  const answered = json(["library", "chat", "--item", saved.id, "what", "does", "it", "say?"]);
  expect(answered.content.length).toBeGreaterThan(0);
});
