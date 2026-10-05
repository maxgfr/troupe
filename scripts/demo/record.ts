// Records the presentation video's footage: the built browser edition, driven
// through one real project in headed Chrome (WebGPU for the voices and the
// chat model). Nothing is staged: the chat model writes the new hook, the
// render runs in the tab, and the MP4 it downloads is the one that plays.
//
//   pnpm site:build && pnpm site:preview      # in another terminal
//   pnpm demo:record                           # footage → DEMO_OUT
//   pnpm demo:edit                             # site/public/demo/troupe-demo.*
//
// Frames come from Chrome's screencast (CDP) as high-quality JPEGs with their
// own timestamps; Playwright's recordVideo encodes 1 Mbit/s VP8, too soft for
// interface text. The run writes to DEMO_OUT (default: <os tmp>/troupe-demo):
//   frames/*.jpg, frames.txt  the footage, as an ffmpeg concat list
//   edl.txt                   the cut: one segment per line (see "The cut")
//   captions.tsv, meta.txt    the steps' names; the playback segment
//   render.mp4                the video the studio rendered and downloaded
//   poster.json               the frame and crop the poster is drawn from
//   cards/*.png               title cards, captions, the poster and the
//                             landing page's social preview, in the site's fonts
//
// `--cards` redraws the cards only, from what an earlier run left in DEMO_OUT.
//
// The browser profile (DEMO_PROFILE, default <os tmp>/troupe-demo-profile)
// keeps the voice and chat models between runs: about 1.2 GB on the first.
// The site's local data is deleted first, so the studio starts empty.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type CDPSession, chromium, type Locator, type Page } from "@playwright/test";

const REPO = resolve(import.meta.dirname, "..", "..");
const BASE_URL = process.env.DEMO_URL ?? "http://localhost:4173";
const APP = "/troupe/app";
const OUT = resolve(process.env.DEMO_OUT ?? join(tmpdir(), "troupe-demo"));
const PROFILE = resolve(process.env.DEMO_PROFILE ?? join(tmpdir(), "troupe-demo-profile"));
// The page is laid out at 1280×720 and captured at twice that, so the cut
// can punch in on the player and the chat without blurring them.
const VIEWPORT = { width: 1280, height: 720 };
const SCALE = 2;

// What the video shows. Change these to record another story.
const PROJECT = process.env.DEMO_PROJECT ?? "Cold brew launch";
const ACTOR = process.env.DEMO_ACTOR ?? "Amara";
const SCRIPT = (process.env.DEMO_SCRIPT ?? "Mornings are hard.\nOur cold brew is smooth, strong and ready in your fridge.\nGrab a bottle on your way out.").split("\\n").join("\n");
const REQUEST = process.env.DEMO_REQUEST ?? "Make the first line punchier. Keep the other lines.";

const WAIT_LONG = 15 * 60_000;

// --- Footage --------------------------------------------------------------

interface Frame {
  file: string;
  at: number;
}

// Chrome's screencast: a frame each time the page paints, with the time it
// was painted. The concat list holds each frame until the next one.
class Footage {
  frames: Frame[] = [];
  start = 0;
  private session: CDPSession | undefined;
  private pending: Promise<void>[] = [];

  async begin(page: Page) {
    rmSync(join(OUT, "frames"), { recursive: true, force: true });
    mkdirSync(join(OUT, "frames"), { recursive: true });
    this.session = await page.context().newCDPSession(page);
    this.session.on("Page.screencastFrame", (event: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
      const at = event.metadata.timestamp ?? Date.now() / 1000;
      if (!this.start) {
        this.start = at;
        // Wall-clock seconds, as now() assumes: anything else would skew the cut.
        if (Math.abs(Date.now() / 1000 - at) > 2) throw new Error(`Unexpected screencast clock: ${at}`);
      }
      const file = join("frames", `${String(this.frames.length).padStart(6, "0")}.jpg`);
      this.frames.push({ file, at: at - this.start });
      writeFileSync(join(OUT, file), Buffer.from(event.data, "base64"));
      this.pending.push(this.session!.send("Page.screencastFrameAck", { sessionId: event.sessionId }).then(() => undefined));
    });
    await this.session.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: VIEWPORT.width * SCALE, maxHeight: VIEWPORT.height * SCALE, everyNthFrame: 1 });
    // The first frame sets the clock.
    while (!this.start) await sleep(50);
  }

  // Seconds since the first frame. Frame timestamps are wall-clock seconds.
  now() {
    return Date.now() / 1000 - this.start;
  }

  async end() {
    await this.session?.send("Page.stopScreencast");
    await Promise.allSettled(this.pending);
    const end = this.now();
    const lines = ["ffconcat version 1.0"];
    this.frames.forEach((frame, i) => {
      const next = this.frames[i + 1]?.at ?? end;
      lines.push(`file '${frame.file}'`, `duration ${Math.max(0.001, next - frame.at).toFixed(4)}`);
    });
    // The concat demuxer drops the last duration unless the file repeats.
    lines.push(`file '${this.frames.at(-1)!.file}'`);
    writeFileSync(join(OUT, "frames.txt"), `${lines.join("\n")}\n`);
  }
}

// --- The cut --------------------------------------------------------------

// One line per segment of footage, read by edit.sh:
//   <start s> <end s> <speed> <crop x:y:w:h in captured px, or -> <caption card>
interface Segment {
  start: number;
  end: number;
  speed: number;
  caption: string;
  crop?: Box;
}
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
const edl: Segment[] = [];
let footage: Footage;
let mark = 0;

// Closes the segment that began at the last cut. `speed` plays it faster;
// `fit` squeezes it into that many seconds instead (never slower than real
// time). A sped-up segment says so in its caption.
function cut(caption: keyof typeof CAPTIONS, pace: { speed?: number; fit?: number } = {}, crop?: Box) {
  const now = footage.now();
  const length = now - mark;
  const speed = pace.fit ? Math.max(1, length / pace.fit) : (pace.speed ?? 1);
  edl.push({ start: mark, end: now, speed: Number(speed.toFixed(3)), caption, crop });
  mark = now;
}

// `box` with some room around it, kept inside the page: the cut scales it
// up to fill the frame's height, on the stage colour.
function around(box: Box, pad: number): Box {
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  return { x, y, width: Math.min(VIEWPORT.width - x, box.width + 2 * pad), height: Math.min(VIEWPORT.height - y, box.height + 2 * pad) };
}

// --- Driving the page like a person ---------------------------------------

// The screencast has no pointer: the page draws one, moved by this script
// only, so a real mouse passing over the window does not show in the video.
// (It can still hover things: keep it off the window while recording.)
const CURSOR = `(() => {
  let c, at = [-100, -100];
  const draw = () => {
    if (c) return;
    c = document.createElement("div");
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l15 8.5-6.6 1.6L8 18.5z" fill="#fff" stroke="#0b1220" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none", filter: "drop-shadow(0 2px 3px rgba(0,0,0,.35))", transitionProperty: "transform", transitionTimingFunction: "cubic-bezier(.3,.7,.3,1)" });
    place(0);
    document.documentElement.appendChild(c);
  };
  const place = (ms) => { c.style.transitionDuration = ms + "ms"; c.style.transform = "translate(" + (at[0] - 3) + "px," + (at[1] - 2) + "px)"; };
  window.__demoCursor = {
    move(x, y, ms) { draw(); at = [x, y]; place(ms); },
    press() {
      const r = document.createElement("div");
      Object.assign(r.style, { position: "fixed", left: at[0] - 14 + "px", top: at[1] - 14 + "px", width: "28px", height: "28px", borderRadius: "50%", border: "2px solid rgba(140,180,255,.9)", zIndex: "2147483646", pointerEvents: "none", transition: "transform 380ms ease-out, opacity 380ms ease-out" });
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = "scale(1.8)"; r.style.opacity = "0"; });
      setTimeout(() => r.remove(), 420);
    },
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", draw); else draw();
})();`;

let page: Page;
let pointer = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

async function moveTo(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error(`Nothing to point at: ${target}`);
  const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await glide(to);
}

// Moves the mouse and the drawn pointer together, at a hand's pace.
async function glide(to: { x: number; y: number }) {
  const distance = Math.hypot(to.x - pointer.x, to.y - pointer.y);
  const ms = Math.round(Math.min(900, 250 + distance * 0.8));
  await page.evaluate(({ x, y, t }) => (window as unknown as { __demoCursor: { move(x: number, y: number, ms: number): void } }).__demoCursor.move(x, y, t), { x: to.x, y: to.y, t: ms });
  await page.mouse.move(to.x, to.y, { steps: Math.max(8, Math.round(distance / 18)) });
  await sleep(Math.max(0, ms - 120));
  pointer = to;
}

async function click(target: Locator) {
  await moveTo(target);
  await sleep(120);
  await page.evaluate(() => (window as unknown as { __demoCursor: { press(): void } }).__demoCursor.press());
  await page.mouse.down();
  await page.mouse.up();
  await sleep(250);
}

async function type(target: Locator, text: string, delay = 38) {
  await click(target);
  await target.pressSequentially(text, { delay });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Title cards ----------------------------------------------------------

function fontFace(family: string, file: string) {
  const data = readFileSync(join(REPO, "node_modules", file)).toString("base64");
  return `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${data}) format("woff2");font-weight:100 900;}`;
}

const CARD_CSS = `
${fontFace("Bricolage", "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2")}
${fontFace("Geist", "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2")}
${fontFace("Mono", "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2")}
*{margin:0;box-sizing:border-box}
html,body{width:1920px;height:1080px;background:transparent;-webkit-font-smoothing:antialiased}
body{font-family:Geist,sans-serif;color:oklch(0.93 0.01 250)}
.stage{position:absolute;inset:0;background:#060c13;display:flex;flex-direction:column;justify-content:center;padding:0 200px}
.mark{font-family:Bricolage;font-weight:700;font-size:168px;letter-spacing:-0.03em;line-height:1}
.ring{position:relative;display:inline-block}
.ring i{position:absolute;inset:-0.02em -0.08em;border:0.06em solid oklch(0.9 0.06 90);border-radius:999px}
.lede{margin-top:40px;font-size:52px;line-height:1.2;max-width:24ch;text-wrap:balance}
.small{margin-top:28px;font-size:30px;color:oklch(0.66 0.02 250)}
.url{font-family:Mono;color:oklch(0.7 0.14 250)}
.cap{position:absolute;left:72px;bottom:64px;display:flex;align-items:baseline;gap:20px;padding:22px 34px 24px;border-radius:14px;background:oklch(0.15 0.02 255 / 0.92);box-shadow:0 8px 30px rgba(0,0,0,.35);outline:2px solid oklch(1 0 0 / 0.08)}
.cap b{font-family:Mono;font-weight:500;font-size:28px;color:oklch(0.7 0.14 250)}
.cap span{font-size:40px;font-weight:550;letter-spacing:-0.01em}
.cap em{font-family:Mono;font-style:normal;font-size:28px;color:oklch(0.66 0.02 250)}
`;

const TITLE = (lede: string, small: string) => `<div class="stage"><div class="mark">tr<span class="ring">o<i></i></span>upe</div><p class="lede">${lede}</p><p class="small">${small}</p></div>`;
const CARDS: Record<string, string> = {
  open: TITLE("A video studio that runs in your browser.", "One project, start to finish, recorded in Chrome. Waits are sped up, and say so."),
  close: TITLE("Open source. In your browser, or on your own server.", `<span class="url">${process.env.DEMO_LINK ?? "github.com/maxgfr/troupe"}</span>`),
};

// The captions: the video's seven steps, numbered.
const CAPTIONS = {
  project: [1, "New project: platform, format, actor"],
  script: [2, "Write the script"],
  chat: [3, "Ask the chat for a punchier hook"],
  writing: [3, "A model on this GPU rewrites it"],
  proposal: [3, "The proposal, against version 1"],
  apply: [4, "Apply &amp; relaunch"],
  render: [5, "Kokoro voices it, WebCodecs encodes it"],
  play: [6, "The render, with its own voice"],
  download: [7, "Download the MP4"],
} as const;

// A caption card per caption and speed: "×12" when the footage is sped up.
function captionCard(segment: Segment) {
  const [step, text] = CAPTIONS[segment.caption as keyof typeof CAPTIONS];
  const fast = segment.speed >= 1.5 ? Math.round(segment.speed) : 0;
  const name = fast ? `cap-${segment.caption}-x${fast}` : `cap-${segment.caption}`;
  CARDS[name] = `<div class="cap"><b>${step}</b><span>${text}</span>${fast ? `<em>×${fast}</em>` : ""}</div>`;
  return name;
}

// The landing page's social preview (1200×630): the wordmark, the line, and
// six of the cast. edit.sh copies it to site/public/social.png.
const SOCIAL_CAST = (process.env.DEMO_SOCIAL_CAST ?? "amara-28,marcus-02,aiko-03,ravi-21,elsa-22,malik-10").split(",");
function socialCard() {
  const picture = (slug: string) => `data:image/webp;base64,${readFileSync(join(REPO, "public", "actors", slug, "v1", "front.webp")).toString("base64")}`;
  return `<style>
html,body{width:1200px;height:630px}
.social{position:absolute;inset:0;background:#060c13;display:grid;grid-template-columns:1fr 470px;align-items:center;gap:56px;padding:0 64px 0 80px}
.social .mark{font-size:112px}
.social .lede{font-size:44px;margin-top:28px;max-width:15ch}
.social .small{font-size:22px;margin-top:26px}
.faces{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.faces img{width:100%;aspect-ratio:1;border-radius:14px;outline:1px solid oklch(1 0 0 / .1);outline-offset:-1px;display:block}
</style><div class="social"><div><div class="mark">tr<span class="ring">o<i></i></span>upe</div><p class="lede">A video studio that runs in your browser.</p><p class="small url">Open source · browser or self-hosted</p></div><div class="faces">${SOCIAL_CAST.map((slug) => `<img src="${picture(slug)}" alt="">`).join("")}</div></div>`;
}

// The video's poster: the render playing, as the cut frames it, beside what
// the video is. Drawn from the captured frame named in poster.json.
interface PosterSource {
  frame: string;
  crop: Box;
}
function posterCard({ frame, crop }: PosterSource) {
  const data = readFileSync(join(OUT, frame)).toString("base64");
  const height = 920;
  const k = height / crop.height;
  return `<style>
.poster{position:absolute;inset:0;background:#060c13;display:grid;grid-template-columns:1fr auto;align-items:center;gap:120px;padding:0 220px 0 200px}
.poster .mark{font-size:120px}
.poster .lede{font-size:64px;margin-top:44px;max-width:14ch}
.poster .small{font-size:30px;margin-top:28px}
.play{margin-top:64px;display:flex;align-items:center;gap:28px;font-size:36px;font-weight:600}
.play i{width:112px;height:112px;border-radius:50%;background:oklch(0.7 0.14 250);display:grid;place-items:center;box-shadow:0 10px 40px oklch(0.7 0.14 250 / .35)}
.shot{width:${Math.round(crop.width * k)}px;height:${height}px;border-radius:24px;background:url(data:image/jpeg;base64,${data}) no-repeat;background-size:${Math.round(VIEWPORT.width * k)}px auto;background-position:${-Math.round(crop.x * k)}px ${-Math.round(crop.y * k)}px;box-shadow:0 20px 60px rgba(0,0,0,.45)}
</style><div class="poster"><div><div class="mark">tr<span class="ring">o<i></i></span>upe</div><p class="lede">One project, start to finish.</p><p class="small">Recorded in Chrome. Waits are sped up, and say so.</p><div class="play"><i><svg width="44" height="50" viewBox="0 0 44 50"><path d="M6 3.5v43L42 25z" fill="#060c13"/></svg></i>Watch</div></div><div class="shot"></div></div>`;
}

async function renderCards(cardPage: Page) {
  mkdirSync(join(OUT, "cards"), { recursive: true });
  const shoot = async (name: string, body: string, size: { width: number; height: number }) => {
    await cardPage.setViewportSize(size);
    await cardPage.setContent(`<!doctype html><html><head><style>${CARD_CSS}</style></head><body>${body}</body></html>`);
    await cardPage.evaluate(() => document.fonts.ready);
    await cardPage.screenshot({ path: join(OUT, "cards", `${name}.png`), omitBackground: name !== "social", scale: "css" });
  };
  for (const [name, body] of Object.entries(CARDS)) await shoot(name, body, { width: 1920, height: 1080 });
  await shoot("social", socialCard(), { width: 1200, height: 630 });
  const poster = join(OUT, "poster.json");
  if (existsSync(poster)) await shoot("poster", posterCard(JSON.parse(readFileSync(poster, "utf8")) as PosterSource), { width: 1920, height: 1080 });
}

// --- The run --------------------------------------------------------------

async function main() {
  mkdirSync(OUT, { recursive: true });
  // `--cards`: only the title cards and the social preview, without recording.
  if (process.argv.includes("--cards")) {
    const browser = await chromium.launch({ channel: process.env.DEMO_CHANNEL ?? "chrome" });
    await renderCards(await browser.newPage());
    await browser.close();
    console.log(`Cards → ${join(OUT, "cards")}`);
    return;
  }
  mkdirSync(PROFILE, { recursive: true });
  // Chrome closes a persistent profile after a download when its history
  // lists one whose file is gone (see site/tests/render.spec.ts).
  rmSync(join(PROFILE, "Default", "History"), { force: true });
  const context = await chromium.launchPersistentContext(PROFILE, {
    channel: process.env.DEMO_CHANNEL ?? "chrome",
    headless: false,
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    colorScheme: "dark",
    acceptDownloads: true,
    baseURL: BASE_URL,
    args: ["--hide-scrollbars", ...(process.env.DEMO_ARGS ?? "").split(" ").filter(Boolean)],
  });
  page = context.pages()[0] ?? (await context.newPage());
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  // Off camera: an empty studio, and the chat model loaded once so the
  // recording waits on writing, not on a first download.
  await page.goto(`${APP}/settings`);
  await page.getByRole("button", { name: "Delete all local data" }).click();
  await page.getByRole("button", { name: "Delete everything" }).click();
  await page.getByText("Create your first project").waitFor({ timeout: 120_000 });
  await context.addInitScript(CURSOR);
  await page.reload();
  await page.getByText("Create your first project").waitFor({ timeout: 120_000 });
  await glide({ x: pointer.x + 1, y: pointer.y });

  footage = new Footage();
  await footage.begin(page);
  await sleep(1200);

  // 1. New project.
  await click(page.getByRole("link", { name: "New project" }).last());
  await page.getByLabel("Project title").waitFor();
  await type(page.getByLabel("Project title"), PROJECT, 55);
  await sleep(300);
  await click(page.getByRole("button", { name: "Continue" }));
  await sleep(800);
  // Format: the model picker offers what this browser can run.
  await page.mouse.wheel(0, 360);
  await sleep(1100);
  await page.mouse.wheel(0, -360);
  await sleep(400);
  await click(page.getByRole("button", { name: "Continue" }));
  await sleep(600);
  await click(page.getByRole("button", { name: "Continue" }));
  await sleep(800);
  const actor = page.locator("label", { has: page.locator('input[name="actor"]:not([disabled])') }).filter({ hasText: ACTOR }).first();
  await click(actor);
  await sleep(400);
  await click(page.getByRole("button", { name: /Create project/ }));
  await page.waitForURL(/\/script$/);
  await sleep(500);
  cut("project", { speed: 2.2 });

  // 2. The script.
  const editor = page.getByLabel(/Write or paste your script/);
  await type(editor, SCRIPT, 32);
  await sleep(400);
  cut("script", { speed: 3 });
  await click(page.getByRole("button", { name: "Save as new version" }));
  await page.getByText(/version 1 · written here/).waitFor();
  await sleep(1200);
  const projectUrl = page.url().replace(/\/script$/, "");
  cut("script", { speed: 1.2 });

  // 3. The chat improves the hook.
  const back = page.getByRole("link", { name: /Back to the project/ }).first();
  if (await back.count()) await click(back);
  else await page.goto(projectUrl);
  await page.waitForURL(projectUrl);
  const chat = page.getByRole("complementary", { name: "Script chat" });
  await chat.getByLabel("Ask for a change").waitFor({ timeout: 60_000 });
  await sleep(600);
  await type(chat.getByLabel("Ask for a change"), REQUEST, 34);
  await sleep(250);
  await click(chat.getByRole("button", { name: "Send" }));
  await chat.getByText(/is writing a new version/).waitFor();
  await sleep(1200);
  cut("chat", { speed: 2 });
  const asked = Date.now();
  await chat.getByText(/is writing a new version/).waitFor({ state: "hidden", timeout: WAIT_LONG });
  console.log(`Chat answered in ${((Date.now() - asked) / 1000).toFixed(0)} s`);
  if (await chat.getByRole("alert").count()) throw new Error(`The chat failed: ${await chat.getByRole("alert").first().innerText()}`);
  cut("writing", { fit: 4 });
  // Read the proposal: the new lines against version 1.
  await chat
    .getByText(/^Compared with version \d+$/)
    .last()
    .evaluate((el) => el.scrollIntoView({ block: "start", behavior: "smooth" }));
  await sleep(600);
  const relaunch = chat.getByRole("button", { name: "Apply & relaunch" }).last();
  await moveTo(relaunch);
  await sleep(4200);
  cut("proposal", {}, around((await chat.boundingBox())!, 16));

  // 4. Apply & relaunch.
  await click(relaunch);
  await chat.getByText("Applied as version 2").waitFor();
  await sleep(1300);
  cut("apply", { speed: 2 });

  // 5. The render, in this tab.
  const video = page.locator("video");
  const launched = Date.now();
  await video.waitFor({ timeout: WAIT_LONG });
  await page.getByText("completed", { exact: true }).waitFor();
  console.log(`Rendered in ${((Date.now() - launched) / 1000).toFixed(0)} s`);
  cut("render", { fit: 3 });
  // Out of the player's way.
  await glide({ x: 1180, y: 690 });
  await sleep(900);
  cut("render");

  // 6. Playback: the player, as large as the page allows.
  await video.evaluate(async (v: HTMLVideoElement) => {
    if (v.readyState < 1) await new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true }));
  });
  const box = (await video.boundingBox())!;
  cut("play");
  const playStart = mark;
  const duration = await video.evaluate(async (v: HTMLVideoElement) => {
    v.currentTime = 0;
    await v.play();
    await new Promise((r) => v.addEventListener("ended", r, { once: true }));
    return v.duration;
  });
  await sleep(500);
  cut("play", {}, around(box, 20));

  // 7. Download.
  const download = page.waitForEvent("download");
  await click(page.getByRole("link", { name: "Download MP4" }).first());
  const saved = await download;
  await saved.saveAs(join(OUT, "render.mp4"));
  await sleep(1600);
  cut("download");

  await footage.end();

  // The edit lays the render's own soundtrack under the playback.
  const playSegment = edl.findIndex((s) => s.start === playStart);
  writeFileSync(
    join(OUT, "edl.txt"),
    `${edl.map((s) => [s.start.toFixed(3), s.end.toFixed(3), s.speed, s.crop ? [s.crop.x, s.crop.y, s.crop.width, s.crop.height].map((n) => Math.round(n * SCALE)).join(":") : "-", captionCard(s)].join(" ")).join("\n")}\n`,
  );
  // The steps' names, for the chapters edit.sh writes.
  writeFileSync(join(OUT, "captions.tsv"), `${Object.entries(CAPTIONS).map(([id, [, text]]) => `${id}\t${text.replace(/&amp;/g, "&")}`).join("\n")}\n`);
  writeFileSync(join(OUT, "meta.txt"), `PLAY_SEGMENT=${playSegment}\nRENDER_DURATION=${duration.toFixed(3)}\nNAME=${saved.suggestedFilename()}\n`);

  // The poster's frame: the render four seconds into its playback.
  const posterAt = playStart + 4;
  const posterFrame = footage.frames.reduce((best, f) => (Math.abs(f.at - posterAt) < Math.abs(best.at - posterAt) ? f : best));
  writeFileSync(join(OUT, "poster.json"), JSON.stringify({ frame: posterFrame.file, crop: around(box, 20) }));
  const cardPage = await context.newPage();
  await renderCards(cardPage);
  await context.close();

  const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height:format=duration", "-of", "compact", join(OUT, "render.mp4")], { encoding: "utf8" });
  console.log(`Footage: ${footage.frames.length} frames, ${footage.now().toFixed(1)} s → ${OUT}`);
  console.log(`Render: ${saved.suggestedFilename()}\n${probe.trim()}`);
  if (errors.length) console.warn(`Page errors:\n${errors.join("\n")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
