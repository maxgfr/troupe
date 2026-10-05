// The presentation video's drawn pictures, in the site's fonts and colours:
// the title cards, the step captions, the poster and the landing page's social
// preview. Each is an HTML card screenshotted by Playwright into
// <out>/cards/<name>.png. Used by record.ts (after a recording, or alone with
// --cards).

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// The captions: the video's seven steps, numbered.
export const CAPTIONS = {
  project: [1, "New project: platform, format, actor"],
  script: [2, "Write the script"],
  chat: [3, "Ask the chat for a punchier hook"],
  writing: [3, "A model on this GPU rewrites it"],
  proposal: [3, "The proposal, against version 1"],
  apply: [4, "Apply & relaunch"],
  render: [5, "Kokoro voices it, WebCodecs encodes it"],
  play: [6, "The render, with its own voice"],
  download: [7, "Download the MP4"],
} as const;
export type CaptionId = keyof typeof CAPTIONS;

// A caption card's name: cap-<step>, or cap-<step>-x<N> when the footage
// under it plays N times faster (the card says "×N").
export function captionName(id: CaptionId, speed: number): string {
  const fast = speed >= 1.5 ? Math.round(speed) : 0;
  return fast ? `cap-${id}-x${fast}` : `cap-${id}`;
}

// The poster's source: a captured frame (relative to <out>) and the region
// of the page, in CSS pixels, it shows.
export interface PosterSource {
  frame: string;
  crop: Box;
}

export interface CardOptions {
  repo: string; // the repository root, for the fonts and the actors' pictures
  out: string; // TOUR_OUT
  link: string; // the closing card's link
  socialCast: string[]; // the actors on the social preview
  pageWidth: number; // the recorded page's width in CSS pixels
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function fontFace(repo: string, family: string, file: string) {
  const data = readFileSync(join(repo, "node_modules", file)).toString("base64");
  return `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${data}) format("woff2");font-weight:100 900;}`;
}

function css(repo: string) {
  return `
${fontFace(repo, "Bricolage", "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2")}
${fontFace(repo, "Geist", "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2")}
${fontFace(repo, "Mono", "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2")}
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
}

const WORDMARK = `<div class="mark">tr<span class="ring">o<i></i></span>upe</div>`;
const title = (lede: string, small: string) => `<div class="stage">${WORDMARK}<p class="lede">${lede}</p><p class="small">${small}</p></div>`;

function captionCard(name: string) {
  const match = /^cap-([a-z]+)(?:-x(\d+))?$/.exec(name);
  const id = match?.[1] as CaptionId | undefined;
  if (!id || !(id in CAPTIONS)) throw new Error(`Unknown caption card: ${name}`);
  const [step, text] = CAPTIONS[id];
  return `<div class="cap"><b>${step}</b><span>${escapeHtml(text)}</span>${match![2] ? `<em>×${match![2]}</em>` : ""}</div>`;
}

// 1200×630: the wordmark, the line, and six of the cast in a 3×2 grid.
function socialCard({ repo, socialCast }: CardOptions) {
  const picture = (slug: string) => `data:image/webp;base64,${readFileSync(join(repo, "public", "actors", slug, "v1", "front.webp")).toString("base64")}`;
  return `<style>
html,body{width:1200px;height:630px}
.social{position:absolute;inset:0;background:#060c13;display:grid;grid-template-columns:1fr 470px;align-items:center;gap:56px;padding:0 64px 0 80px}
.social .mark{font-size:112px}
.social .lede{font-size:44px;margin-top:28px;max-width:15ch}
.social .small{font-size:22px;margin-top:26px}
.faces{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.faces img{width:100%;aspect-ratio:1;border-radius:14px;outline:1px solid oklch(1 0 0 / .1);outline-offset:-1px;display:block}
</style><div class="social"><div>${WORDMARK}<p class="lede">A video studio that runs in your browser.</p><p class="small url">Open source · browser or self-hosted</p></div><div class="faces">${socialCast.map((slug) => `<img src="${picture(slug)}" alt="">`).join("")}</div></div>`;
}

// The video's poster: the render playing, as the cut frames it, beside what
// the video is.
function posterCard({ out, pageWidth }: CardOptions, { frame, crop }: PosterSource) {
  const data = readFileSync(join(out, frame)).toString("base64");
  const height = 920;
  const k = height / crop.height;
  return `<style>
.poster{position:absolute;inset:0;background:#060c13;display:grid;grid-template-columns:1fr auto;align-items:center;gap:120px;padding:0 220px 0 200px}
.poster .mark{font-size:120px}
.poster .lede{font-size:64px;margin-top:44px;max-width:14ch}
.poster .small{font-size:30px;margin-top:28px}
.play{margin-top:64px;display:flex;align-items:center;gap:28px;font-size:36px;font-weight:600}
.play i{width:112px;height:112px;border-radius:50%;background:oklch(0.7 0.14 250);display:grid;place-items:center;box-shadow:0 10px 40px oklch(0.7 0.14 250 / .35)}
.shot{width:${Math.round(crop.width * k)}px;height:${height}px;border-radius:24px;background:url(data:image/jpeg;base64,${data}) no-repeat;background-size:${Math.round(pageWidth * k)}px auto;background-position:${-Math.round(crop.x * k)}px ${-Math.round(crop.y * k)}px;box-shadow:0 20px 60px rgba(0,0,0,.45)}
</style><div class="poster"><div>${WORDMARK}<p class="lede">One project, start to finish.</p><p class="small">Recorded in Chrome. Waits are sped up, and say so.</p><div class="play"><i><svg width="44" height="50" viewBox="0 0 44 50"><path d="M6 3.5v43L42 25z" fill="#060c13"/></svg></i>Watch</div></div><div class="shot"></div></div>`;
}

// Draws every card: the title cards, the named captions, the social preview,
// and the poster when <out>/poster.json says which frame to use.
export async function drawCards(page: Page, options: CardOptions, captions: string[]) {
  const dir = join(options.out, "cards");
  mkdirSync(dir, { recursive: true });
  const style = css(options.repo);
  const shoot = async (name: string, body: string, size = { width: 1920, height: 1080 }) => {
    await page.setViewportSize(size);
    await page.setContent(`<!doctype html><html><head><style>${style}</style></head><body>${body}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    // Captions and title cards keep their transparency for the overlay.
    await page.screenshot({ path: join(dir, `${name}.png`), omitBackground: name !== "social", scale: "css" });
  };
  await shoot("open", title("A video studio that runs in your browser.", "One project, start to finish, recorded in Chrome. Waits are sped up, and say so."));
  await shoot("close", title("Open source. In your browser, or on your own server.", `<span class="url">${escapeHtml(options.link)}</span>`));
  for (const name of new Set(captions)) await shoot(name, captionCard(name));
  await shoot("social", socialCard(options), { width: 1200, height: 630 });
  const poster = join(options.out, "poster.json");
  if (existsSync(poster)) await shoot("poster", posterCard(options, JSON.parse(readFileSync(poster, "utf8")) as PosterSource));
}
