import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

import { PROJECT } from "./stack";

// The self-hosted studio as a person meets it after `docker compose up`:
// sign in with the access code, make a project, write a script, ask the chat
// (the stack's Ollama) for a change, render it on the stack's renderer, play
// it, export it and download it, without ever opening Settings: the stack
// wired the renderer and the chat itself (src/server/autoconfigure.ts).

const CODE = process.env.E2E_ACCESS_CODE ?? "";
const SCRIPT = "Mornings are hard.\nOur cold brew is smooth and ready in your fridge.\nGrab a bottle on your way out.";

test.describe.configure({ mode: "serial" });

// Anything the browser logs as an error is a bug.
function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test("open the studio → new project → script → chat → render → play → export → download", async ({ page }, testInfo) => {
  expect(CODE, "E2E_ACCESS_CODE: run through pnpm e2e:docker").not.toBe("");
  const errors = watchConsole(page);
  const shot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`);
    await page.screenshot({ path, fullPage: true });
    await testInfo.attach(name, { path, contentType: "image/png" });
  };
  const visited: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname);
  });

  // 1. The access code the stack was started with.
  await page.goto("/");
  await expect(page).toHaveURL(/\/access/);
  await page.getByLabel("Access code").fill(CODE);
  await page.getByRole("button", { name: "Open studio" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await shot("01-dashboard");

  // 2. A new project: the stack's renderer is the default model.
  await page.getByRole("link", { name: "New project" }).first().click();
  await page.getByLabel("Project title").fill(PROJECT);
  await page.getByRole("button", { name: "Continue" }).click();
  const renderer = page.getByRole("radio", { name: /Local renderer/ });
  await expect(renderer).toBeChecked();
  await expect(page.locator("label").filter({ has: renderer })).toContainText("default");
  await shot("02-format");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator('label:has(input[name="actor"]:not([disabled]))').first().click();
  await page.getByRole("button", { name: /Create project/ }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}\/script$/);
  const projectUrl = page.url().replace(/\/script$/, "");

  // 3. The script.
  await page.getByLabel(/Write or paste your script/).fill(SCRIPT);
  await page.getByRole("button", { name: "Save as new version" }).click();
  await expect(page.getByText(/version 1 · written here/)).toBeVisible();
  await shot("03-script");

  // 4. The chat, on the stack's Ollama.
  await page.goto(projectUrl);
  await expect(page.getByRole("combobox", { name: "Video model" })).toHaveValue(/local-stack-renderer/);
  const chat = page.getByRole("complementary", { name: "Script chat" });
  await expect(chat.getByText(/^Ollama · /)).toBeVisible();
  // The test stack's model is small (qwen2.5:0.5b): asked plainly, it changes
  // the script, but now and then it answers with the same lines, or with
  // something that is not a script, or runs out of time. Ask again, in other
  // words, until a proposal has something to apply: two tries, each settled
  // by the server within TROUPE_CHAT_SEND_TIMEOUT_S (240 s here), with what
  // each did recorded.
  const asks = ['Replace the first line with "Tired of slow mornings?" and keep the other two lines.', "Rewrite line 1 as: Tired of slow mornings?"];
  const apply = chat.getByRole("button", { name: "Apply & relaunch" });
  const answers = chat.getByRole("article", { name: "Answer" });
  const tried: string[] = [];
  for (const ask of asks) {
    const before = await answers.count();
    await chat.getByLabel("Ask for a change").fill(ask);
    await chat.getByRole("button", { name: "Send" }).click();
    // Settled: an answer (a proposal, or what could not be read), or the
    // reason there is none.
    await expect(answers.nth(before).or(chat.getByRole("alert"))).toBeVisible({ timeout: (240 + 60) * 1000 });
    const alert = chat.getByRole("alert");
    const answer = answers.nth(before);
    tried.push(
      (await alert.isVisible())
        ? `stopped: ${await alert.innerText()}`
        : (await answer.getByText(/^Compared with version 1$/).count())
          ? (await apply.count()) ? "proposal to apply" : "proposal, same lines"
          : "not a script",
    );
    if (await apply.count()) break;
  }
  test.info().annotations.push({ type: "script chat tries", description: tried.join(" | ") });
  expect(await apply.count(), `no proposal to apply in ${tried.length} tries: ${tried.join(" | ")}`).toBeGreaterThan(0);
  await shot("04-chat-proposal");

  // 5. Apply & relaunch renders the new version on the stack's renderer.
  await apply.last().click();
  await expect(chat.getByText("Applied as version 2")).toBeVisible();
  const video = page.locator("video").first();
  await expect(video).toBeVisible({ timeout: 10 * 60_000 });
  await expect(page.getByText("completed", { exact: true }).first()).toBeVisible();
  await shot("05-rendered");

  // 6. It plays, with sound.
  const played = await video.evaluate(async (v: HTMLVideoElement) => {
    if (v.readyState < 1) await new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true }));
    v.muted = true;
    v.currentTime = 0;
    await v.play();
    await new Promise((r) => setTimeout(r, 1500));
    v.pause();
    return { duration: v.duration, at: v.currentTime, width: v.videoWidth, height: v.videoHeight };
  });
  expect(played.duration).toBeGreaterThan(2);
  expect(played.at).toBeGreaterThan(0.5);
  expect(played).toMatchObject({ width: 720, height: 1280 });
  await shot("06-played");

  // 7. Export for TikTok, then download the MP4.
  await page.getByRole("link", { name: "Export", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Export" })).toBeVisible();
  await page.getByLabel("I have checked the video and am ready to download it.").check();
  await page.getByRole("button", { name: "Create export" }).click();
  await expect(page.getByText(/Export saved for TikTok/)).toBeVisible();
  await shot("07-exported");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download MP4" }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toMatch(/^docker-end-to-end-.*\.mp4$/);
  const file = testInfo.outputPath("render.mp4");
  await saved.saveAs(file);

  // A real MP4: H.264 and AAC, 720×1280, as long as the player said.
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height:format=duration", "-of", "json", file], { encoding: "utf8" }));
  const streams = probe.streams as { codec_type: string; codec_name: string; width?: number; height?: number }[];
  expect(streams.find((s) => s.codec_type === "video")).toMatchObject({ codec_name: "h264", width: 720, height: 1280 });
  expect(streams.find((s) => s.codec_type === "audio")).toMatchObject({ codec_name: "aac" });
  expect(Math.abs(Number(probe.format.duration) - played.duration)).toBeLessThan(0.5);
  expect(readFileSync(file).subarray(4, 8).toString()).toBe("ftyp");

  // Nothing needed Settings.
  expect(visited.filter((path) => path.startsWith("/settings"))).toEqual([]);
  // The tRPC logger also prints a chat request stopped at its time limit,
  // which the chat step above asks again for.
  expect(errors.filter((error) => !/took longer than \d+ s to write a new version/.test(error))).toEqual([]);
});
