import type { Emotion } from "~/modules/script";
import { cueAt, type Box, type Cue, type Scene } from "./build";

// The slice of the Canvas 2D API drawFrame uses. Both the browser's
// OffscreenCanvasRenderingContext2D and @napi-rs/canvas's context fit it, so
// the same code draws in both places.
export interface SceneGradient {
  addColorStop(offset: number, color: string): void;
}

// A decoded picture the context can draw: @napi-rs/canvas's Image in Node,
// an ImageBitmap in the browser. Each renderer loads its own and draws
// through a context typed with it.
export interface SceneImage {
  readonly width: number;
  readonly height: number;
}

export interface SceneContext<Image extends SceneImage = SceneImage> {
  // A color string or a gradient from this context.
  fillStyle: string | object;
  strokeStyle: string | object;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  globalAlpha: number;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: "low" | "medium" | "high";
  save(): void;
  restore(): void;
  beginPath(): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  roundRect(x: number, y: number, width: number, height: number, radius: number): void;
  fill(): void;
  clip(): void;
  stroke(): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  drawImage(
    image: Image,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): SceneGradient;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): SceneGradient;
}

// The family renderers must make available: Geist, the app's sans-serif, or
// the file a self-hoster registers under this name instead (SCENE_FONT_FILE,
// VITE_SCENE_FONT_URL).
export const SCENE_FONT = "Geist";
const font = (weight: number, px: number) => `${weight} ${px.toFixed(2)}px ${SCENE_FONT}, sans-serif`;

const LINE_HEIGHT = 1.25;
const MIN_CAPTION_SCALE = 0.35;
// In font sizes: the pill's side padding behind the word being said, and the
// extra word spacing that keeps it clear of the next word.
const WORD_PILL_PAD = 0.1;
const WORD_GAP_EXTRA = 0.08;
// How far the shade behind laid-over captions fades out past their rows, in
// font sizes.
const SHADE_REACH = 1.2;

function background(ctx: SceneContext, scene: Scene, t: number) {
  const { width: w, height: h, palette } = scene;
  const base = ctx.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, palette.backgroundTop);
  base.addColorStop(1, palette.backgroundBottom);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  // Two soft glows drifting slowly: enough motion to read as video.
  const reach = Math.max(w, h) * 0.6;
  const glows = [
    [w * (0.5 + 0.3 * Math.sin(t * 0.4)), h * (0.3 + 0.1 * Math.cos(t * 0.3))],
    [w * (0.5 + 0.35 * Math.cos(t * 0.25 + 1)), h * (0.75 + 0.1 * Math.sin(t * 0.35))],
  ] as const;
  for (const [x, y] of glows) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, reach);
    glow.addColorStop(0, palette.glow);
    glow.addColorStop(1, palette.glowFade);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  }
}

// The largest size, at most `start`, at which `text` fits in `maxWidth`.
function fitWidth(ctx: SceneContext, text: string, weight: number, start: number, maxWidth: number): number {
  let px = start;
  ctx.font = font(weight, px);
  while (px > start * MIN_CAPTION_SCALE && ctx.measureText(text).width > maxWidth) {
    px *= 0.9;
    ctx.font = font(weight, px);
  }
  return px;
}

// The actor's pictures (actors/<slug>/v<n>/<shot>.webp): the front portrait
// and the expressions a line's emotion can call for.
export type PortraitShot = "front" | "happy" | "calm" | "excited";
export type ScenePortraits<Image extends SceneImage = SceneImage> = Partial<Record<PortraitShot, Image>>;

// The picture for a line said with `emotion`: its own expression when the
// set has one, the front portrait otherwise.
export function portraitShotFor(emotion: Emotion): PortraitShot {
  return emotion === "happy" || emotion === "calm" || emotion === "excited" ? emotion : "front";
}

// The pictures a scene shows, front first: what a renderer needs to load.
export function portraitShots(scene: Scene): PortraitShot[] {
  return [...new Set<PortraitShot>(["front", ...scene.cues.map((c) => portraitShotFor(c.emotion))])];
}

// How long the card takes to cross-fade to the next line's expression.
const PORTRAIT_FADE_S = 0.25;

function pictureFor<Image extends SceneImage>(
  portraits: ScenePortraits<Image>,
  cue: Cue | undefined,
): Image | undefined {
  return (cue && portraits[portraitShotFor(cue.emotion)]) ?? portraits.front;
}

// `image` filling the portrait's circle, cropped to its centred square.
function drawPicture<Image extends SceneImage>(ctx: SceneContext<Image>, scene: Scene, image: Image, alpha: number) {
  const { cx, cy, r } = scene.layout.portrait;
  const side = Math.min(image.width, image.height);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, cx - r, cy - r, 2 * r, 2 * r);
  ctx.restore();
}

// The portrait: the picture for the line on screen, faded in over the
// previous line's when it changes; the initials on a disc without pictures.
function drawPortrait<Image extends SceneImage>(
  ctx: SceneContext<Image>,
  scene: Scene,
  t: number,
  portraits: ScenePortraits<Image>,
) {
  const { layout, palette, actor } = scene;
  const { portrait: disc } = layout;
  const cue = cueAt(scene, t);
  const current = pictureFor(portraits, cue);
  if (current) {
    const previous = cue && cue.index > 0 ? pictureFor(portraits, scene.cues[cue.index - 1]) : undefined;
    const fade = cue ? (t - cue.startS) / PORTRAIT_FADE_S : 1;
    if (previous && previous !== current && fade >= 0 && fade < 1) {
      drawPicture(ctx, scene, previous, 1);
      drawPicture(ctx, scene, current, fade);
    } else {
      drawPicture(ctx, scene, current, 1);
    }
    return;
  }
  ctx.fillStyle = palette.portrait;
  ctx.beginPath();
  ctx.arc(disc.cx, disc.cy, disc.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = palette.portraitInk;
  ctx.font = font(600, disc.r * 0.6);
  ctx.textAlign = "center";
  ctx.fillText(actor.initials, disc.cx, disc.cy);
}

// A pill hugging the portrait and the name: concentric with the portrait,
// as wide as the name needs, at most the layout's card box.
function card<Image extends SceneImage>(
  ctx: SceneContext<Image>,
  scene: Scene,
  t: number,
  portraits: ScenePortraits<Image>,
) {
  const { layout, palette, actor } = scene;
  const { card: box, portrait, padding } = layout;
  const textX = portrait.cx + portrait.r + padding;
  const endPadding = box.height * 0.4;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  fitWidth(ctx, actor.name, 600, layout.nameSize, box.x + box.width - endPadding - textX);
  const width = Math.min(box.width, textX + ctx.measureText(actor.name).width + endPadding - box.x);
  const nameFont = ctx.font;

  ctx.fillStyle = palette.card;
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, width, box.height, box.height / 2);
  ctx.fill();

  const cue = cueAt(scene, t);
  if (cue && t >= cue.startS && t < cue.endS) {
    ctx.strokeStyle = palette.highlight;
    ctx.lineWidth = portrait.r * 0.06;
    ctx.beginPath();
    ctx.arc(portrait.cx, portrait.cy, portrait.r * (1.06 + 0.025 * Math.sin(t * 9)), 0, Math.PI * 2);
    ctx.stroke();
  }
  drawPortrait(ctx, scene, t, portraits);

  ctx.textAlign = "left";
  ctx.fillStyle = palette.ink;
  ctx.font = nameFont;
  ctx.fillText(actor.name, textX, portrait.cy);
}

interface Placed {
  text: string;
  index: number;
  row: number;
  x: number;
  y: number;
}

type Row = { indices: number[]; width: number };

// Greedy line breaking at a given measure.
function breakRows(widths: number[], gap: number, measure: number): Row[] {
  const rows: Row[] = [];
  for (const [i, width] of widths.entries()) {
    const row = rows.at(-1);
    if (row && row.width + gap + width <= measure) {
      row.indices.push(i);
      row.width += gap + width;
    } else {
      rows.push({ indices: [i], width });
    }
  }
  return rows;
}

// Wraps words into centered, balanced lines that fit the box, shrinking the
// font until they do. Returns the size used and each word's position.
function wrap(ctx: SceneContext, words: string[], box: Box, start: number): { px: number; placed: Placed[] } {
  let px = start;
  for (;;) {
    ctx.font = font(700, px);
    // A little wider than a space, so the pill behind a word clears its
    // neighbours.
    const gap = ctx.measureText(" ").width + px * WORD_GAP_EXTRA;
    const widths = words.map((w) => ctx.measureText(w).width);
    let rows = breakRows(widths, gap, box.width);
    const lineHeight = px * LINE_HEIGHT;
    const fits = rows.length * lineHeight <= box.height && widths.every((w) => w <= box.width);
    if (fits || px * 0.9 < start * MIN_CAPTION_SCALE) {
      // Balance: the narrowest measure that keeps the same number of lines,
      // so the last line is not a lone word.
      let lo = Math.max(...widths);
      let hi = box.width;
      for (let i = 0; i < 12 && hi - lo > 1; i++) {
        const mid = (lo + hi) / 2;
        if (breakRows(widths, gap, mid).length <= rows.length) hi = mid;
        else lo = mid;
      }
      rows = breakRows(widths, gap, hi);
      const top = box.y + Math.max(0, (box.height - rows.length * lineHeight) / 2);
      const placed: Placed[] = [];
      for (const [r, row] of rows.entries()) {
        let x = box.x + (box.width - row.width) / 2;
        for (const i of row.indices) {
          placed.push({ text: words[i]!, index: i, row: r, x, y: top + r * lineHeight });
          x += widths[i]! + gap;
        }
      }
      return { px, placed };
    }
    px *= 0.9;
  }
}

// The rows that fit in the box, when the line still does not at the smallest
// size: the page of rows holding the word being said (or the last one said),
// moved up to the top of the box.
function page(placed: Placed[], cue: Cue, t: number, box: Box, px: number): Placed[] {
  const lineHeight = px * LINE_HEIGHT;
  const fit = Math.max(1, Math.floor(box.height / lineHeight));
  const rows = (placed.at(-1)?.row ?? 0) + 1;
  if (rows <= fit) return placed;
  let current = 0;
  for (const [i, word] of cue.words.entries()) if (word.startS <= t) current = i;
  const first = Math.floor((placed.find((w) => w.index === current)?.row ?? 0) / fit) * fit;
  return placed
    .filter((w) => w.row >= first && w.row < first + fit)
    .map((w) => ({ ...w, y: box.y + (w.row - first) * lineHeight }));
}

function captions(ctx: SceneContext, scene: Scene, t: number, shaded: boolean) {
  const cue = cueAt(scene, t);
  if (!cue) return;
  const { palette, layout } = scene;
  const box = shaded ? layout.overlayCaptions : layout.captions;
  const wrapped = wrap(
    ctx,
    cue.words.map((w) => w.text),
    box,
    layout.captionSize,
  );
  const { px } = wrapped;
  const placed = page(wrapped.placed, cue, t, box, px);
  if (shaded && placed.length > 0) {
    const rows = placed.map((w) => w.y);
    shade(ctx, scene, Math.min(...rows) - px * 0.5, Math.max(...rows) + px * (LINE_HEIGHT + 0.5), px);
  }
  ctx.font = font(700, px);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (const word of placed) {
    const timing = cue.words[word.index]!;
    const saying = t >= timing.startS && t < timing.endS;
    if (saying) {
      // The word being said sits on a pill, karaoke style.
      const padX = px * WORD_PILL_PAD;
      const height = px * 1.22;
      ctx.fillStyle = palette.highlight;
      ctx.beginPath();
      ctx.roundRect(
        word.x - padX,
        word.y - px * 0.08,
        ctx.measureText(word.text).width + 2 * padX,
        height,
        height * 0.28,
      );
      ctx.fill();
    }
    ctx.fillStyle = saying || t >= timing.endS ? palette.ink : shaded ? palette.inkMutedOver : palette.inkMuted;
    ctx.fillText(word.text, word.x, word.y);
  }
}

// A soft band across the frame behind the caption rows, so the words read on
// whatever picture they are laid over: dark in the middle, fading out above
// and below.
function shade(ctx: SceneContext, scene: Scene, top: number, bottom: number, px: number) {
  const { width: w, height: h, palette } = scene;
  const reach = px * SHADE_REACH;
  const from = Math.max(0, top - reach);
  const to = Math.min(h, bottom + reach);
  const band = ctx.createLinearGradient(0, from, 0, to);
  const edge = (top - from) / (to - from);
  band.addColorStop(0, palette.shadeFade);
  band.addColorStop(edge, palette.shade);
  band.addColorStop(1 - (to - bottom) / (to - from), palette.shade);
  band.addColorStop(1, palette.shadeFade);
  ctx.fillStyle = band;
  ctx.fillRect(0, from, w, to - from);
}

export interface DrawOptions<Image extends SceneImage = SceneImage> {
  // Only the captions, on a soft shade, over a transparent frame: for laying
  // the script over a video made elsewhere.
  captionsOnly?: boolean;
  // The actor's pictures, decoded by the renderer. Without them, or for an
  // expression the set lacks, the card shows the front portrait, then the
  // initials.
  portraits?: ScenePortraits<Image>;
}

// Draws the frame at time t (seconds): background, actor card, captions.
export function drawFrame<Image extends SceneImage>(
  ctx: SceneContext<Image>,
  scene: Scene,
  t: number,
  options: DrawOptions<Image> = {},
): void {
  ctx.save();
  ctx.globalAlpha = 1;
  if (options.captionsOnly) {
    ctx.clearRect(0, 0, scene.width, scene.height);
  } else {
    background(ctx, scene, t);
    card(ctx, scene, t, options.portraits ?? {});
  }
  captions(ctx, scene, t, options.captionsOnly === true);
  ctx.restore();
}
