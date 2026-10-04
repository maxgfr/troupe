import { cueAt, type Box, type Scene } from "./build";

// The slice of the Canvas 2D API drawFrame uses. Both the browser's
// OffscreenCanvasRenderingContext2D and @napi-rs/canvas's context fit it, so
// the same code draws in both places.
export interface SceneGradient {
  addColorStop(offset: number, color: string): void;
}

export interface SceneContext {
  // A color string or a gradient from this context.
  fillStyle: string | object;
  strokeStyle: string | object;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  globalAlpha: number;
  save(): void;
  restore(): void;
  beginPath(): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  roundRect(x: number, y: number, width: number, height: number, radius: number): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): SceneGradient;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): SceneGradient;
}

// The family renderers must make available (the app's sans-serif).
export const SCENE_FONT = "Geist";
const font = (weight: number, px: number) => `${weight} ${px.toFixed(2)}px ${SCENE_FONT}, sans-serif`;

const LINE_HEIGHT = 1.25;
const MIN_CAPTION_SCALE = 0.35;

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

function card(ctx: SceneContext, scene: Scene, t: number) {
  const { layout, palette, actor } = scene;
  const { card: box, portrait, padding } = layout;
  ctx.fillStyle = palette.card;
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.width, box.height, padding);
  ctx.fill();

  const cue = cueAt(scene, t);
  const speaking = cue !== undefined && t >= cue.startS && t < cue.endS;
  if (speaking) {
    ctx.strokeStyle = palette.highlight;
    ctx.lineWidth = portrait.r * 0.06;
    ctx.beginPath();
    ctx.arc(portrait.cx, portrait.cy, portrait.r * (1.06 + 0.025 * Math.sin(t * 9)), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = palette.portrait;
  ctx.beginPath();
  ctx.arc(portrait.cx, portrait.cy, portrait.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = palette.portraitInk;
  ctx.font = font(600, portrait.r * 0.6);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(actor.initials, portrait.cx, portrait.cy);

  const textX = portrait.cx + portrait.r + padding;
  const room = box.x + box.width - padding - textX;
  ctx.textAlign = "left";
  ctx.fillStyle = palette.ink;
  fitWidth(ctx, actor.name, 600, layout.nameSize, room);
  ctx.fillText(actor.name, textX, portrait.cy - layout.nameSize * 0.45);
  if (cue) {
    const tag = `${cue.role.toUpperCase()} · ${cue.emotion}`;
    ctx.fillStyle = palette.inkMuted;
    fitWidth(ctx, tag, 500, layout.tagSize, room);
    ctx.fillText(tag, textX, portrait.cy + layout.tagSize * 0.9);
  }
}

interface Placed {
  text: string;
  index: number;
  x: number;
  y: number;
}

// Wraps words into centered lines that fit the box, shrinking the font
// until they do. Returns the size used and each word's position.
function wrap(ctx: SceneContext, words: string[], box: Box, start: number): { px: number; placed: Placed[] } {
  let px = start;
  for (;;) {
    ctx.font = font(700, px);
    const space = ctx.measureText(" ").width;
    const widths = words.map((w) => ctx.measureText(w).width);
    const rows: { indices: number[]; width: number }[] = [];
    for (const [i, width] of widths.entries()) {
      const row = rows.at(-1);
      if (row && row.width + space + width <= box.width) {
        row.indices.push(i);
        row.width += space + width;
      } else {
        rows.push({ indices: [i], width });
      }
    }
    const lineHeight = px * LINE_HEIGHT;
    const fits = rows.length * lineHeight <= box.height && widths.every((w) => w <= box.width);
    if (fits || px * 0.9 < start * MIN_CAPTION_SCALE) {
      const top = box.y + Math.max(0, (box.height - rows.length * lineHeight) / 2);
      const placed: Placed[] = [];
      for (const [r, row] of rows.entries()) {
        let x = box.x + (box.width - row.width) / 2;
        for (const i of row.indices) {
          placed.push({ text: words[i]!, index: i, x, y: top + r * lineHeight });
          x += widths[i]! + space;
        }
      }
      return { px, placed };
    }
    px *= 0.9;
  }
}

function captions(ctx: SceneContext, scene: Scene, t: number) {
  const cue = cueAt(scene, t);
  if (!cue) return;
  const { palette, layout } = scene;
  const { px, placed } = wrap(ctx, cue.words.map((w) => w.text), layout.captions, layout.captionSize);
  ctx.font = font(700, px);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (const word of placed) {
    const timing = cue.words[word.index]!;
    ctx.fillStyle = t >= timing.endS ? palette.ink : t >= timing.startS ? palette.highlight : palette.inkMuted;
    ctx.fillText(word.text, word.x, word.y);
  }
}

// Draws the frame at time t (seconds): background, actor card, captions.
export function drawFrame(ctx: SceneContext, scene: Scene, t: number): void {
  ctx.save();
  ctx.globalAlpha = 1;
  background(ctx, scene, t);
  card(ctx, scene, t);
  captions(ctx, scene, t);
  ctx.restore();
}
