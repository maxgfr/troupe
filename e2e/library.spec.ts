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
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

const row = (page: Page, title: RegExp): Locator => page.locator("table").getByRole("row", { name: title }).first();

test("upload a video, save an article and a video from links, search, ask, make an idea a project, render it and play it", async ({ page }, testInfo) => {
  test.setTimeout(60 * 60_000);
  const errors = watchConsole(page);
  const shot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`);
    await page.screenshot({ path, fullPage: true });
    await testInfo.attach(name, { path, contentType: "image/png" });
  };
  await signIn(page);
  await page.getByRole("link", { name: "Library" }).click();
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
  await page.getByRole("link", { name: "← Library" }).click();
  await row(page, /Three hooks that work/).getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1, name: "Three hooks that work" })).toBeVisible();
  await expect(page.getByText("Ask a question the viewer cannot answer yet").first()).toBeVisible();
  await expect(page.getByText("Home · Archive · About")).toHaveCount(0);
  await page.getByRole("link", { name: "← Library" }).click();

  // Search by meaning.
  await page.getByLabel("Search your library").fill("making coffee in the fridge overnight");
  await expect(page.getByText(/closest in meaning first/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("link", { name: /cold brew/i }).first()).toBeVisible();
  await page.getByLabel("Search your library").fill("");

  // Ask the library: the answer cites what it used. The test stack's 0.5B
  // model sometimes answers without citing; a person asks again.
  const chat = page.getByRole("complementary", { name: "Ask your library" });
  const sources = chat.getByRole("list", { name: "Sources" });
  for (let i = 0; i < 3 && (await sources.count()) === 0; i++) {
    const answers = await chat.locator("p.whitespace-pre-wrap").count();
    await chat.getByLabel("Ask your library").fill("Which saved piece talks about cold brew, and how does it open?");
    await chat.getByRole("button", { name: "Ask" }).click();
    await expect(chat.locator("p.whitespace-pre-wrap")).toHaveCount(answers + 2, { timeout: 10 * 60_000 });
    await expect(chat.getByText(/is reading your library/)).toBeHidden();
    await expect(chat.getByRole("alert")).toHaveCount(0);
  }
  await expect(sources.first()).toBeVisible();
  // A citation opens the item it cites.
  await expect(sources.first().getByRole("link").first()).toHaveAttribute("href", /\/library\/[0-9a-f-]{36}/);
  await shot("03-chat");

  // Ideas in the style of the video; one short enough for the stack's
  // renderer (15 s at most) made into a project. The 0.5B model sometimes
  // writes none, or only long ones: a person asks again.
  await page.locator("table").getByRole("link", { name: /cold brew trick/i }).click();
  const write = page.getByRole("button", { name: "10 ideas in this style" });
  const fitting = page.locator("li").filter({ hasText: /about ([1-9]|1[0-5]) s/ }).getByRole("button", { name: "Create project" });
  for (let i = 0; i < 3 && (await fitting.count()) === 0; i++) {
    await write.click();
    await expect(page.getByRole("button", { name: "Writing 10 ideas…" })).toBeVisible();
    await expect(write).toBeEnabled({ timeout: 10 * 60_000 });
  }
  await expect(fitting.first()).toBeVisible();
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
  expect(errors).toEqual([]);
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
