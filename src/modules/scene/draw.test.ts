import { describe, expect, it } from "vitest";

import { sizeFor } from "~/modules/models/geometry";
import { buildScene, type SceneInput } from "./build";
import { drawFrame, type SceneContext } from "./draw";

// Both renderers hand drawFrame a real canvas context: the browser's
// OffscreenCanvas one must fit the interface (the Node one is checked where
// the renderer creates it).
const _browserContextFits = (ctx: OffscreenCanvasRenderingContext2D): SceneContext => ctx;
void _browserContextFits;

interface TextCall {
  text: string;
  x: number;
  y: number;
  font: string;
  fill: unknown;
  align: string;
}

// A context that records what is drawn. Text is measured as half the font
// size per character, which is close enough to Geist for layout checks.
function recorder(width: number, height: number) {
  const texts: TextCall[] = [];
  const fills: { x: number; y: number; width: number; height: number }[] = [];
  const gradient = () => ({ addColorStop() {} });
  const ctx: SceneContext = {
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    save() {},
    restore() {},
    beginPath() {},
    arc() {},
    roundRect() {},
    fill() {},
    stroke() {},
    fillRect(x, y, w, h) {
      fills.push({ x, y, width: w, height: h });
    },
    fillText(text, x, y) {
      texts.push({ text, x, y, font: ctx.font, fill: ctx.fillStyle, align: ctx.textAlign });
    },
    measureText(text) {
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 10);
      return { width: text.length * px * 0.5 };
    },
    createLinearGradient: gradient,
    createRadialGradient: gradient,
  };
  return { ctx, texts, fills, width, height };
}

const actor = { id: "6f1c0e8a-2b7d-4c1e-9a53-0d6e2f4b8c11", name: "Léa Martin" };
const lines: SceneInput["lines"] = [
  { role: "hook", text: "This ended my search for good coffee.", emotion: "excited" },
  { role: "cta", text: "Grab yours today.", emotion: "calm" },
];

function draw(t: number, patch: Partial<SceneInput> = {}) {
  const scene = buildScene({ width: 720, height: 1280, fps: 24, actor, lines, speechS: [2.8, 1.2], ...patch });
  const rec = recorder(scene.width, scene.height);
  drawFrame(rec.ctx, scene, t);
  return { ...rec, scene };
}

const fontPx = (font: string) => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1]);
const captionWords = (rec: ReturnType<typeof draw>) => {
  const { captions } = rec.scene.layout;
  return rec.texts.filter((t) => t.y >= captions.y && t.y <= captions.y + captions.height && t.x >= captions.x);
};

describe("drawFrame", () => {
  it("paints the whole frame before anything else", () => {
    const { fills } = draw(0);
    expect(fills[0]).toEqual({ x: 0, y: 0, width: 720, height: 1280 });
  });

  it("draws the actor card: initials, name and the line's role and emotion", () => {
    const { texts } = draw(0.5);
    const shown = texts.map((t) => t.text);
    expect(shown).toContain("LM");
    expect(shown).toContain("Léa Martin");
    expect(shown).toContain("HOOK · excited");
    expect(draw(4).texts.map((t) => t.text)).toContain("CTA · calm");
  });

  it("writes the current line word by word, lighting words up as they are said", () => {
    const before = draw(0);
    const words = captionWords(before);
    expect(words.map((w) => w.text)).toEqual(lines[0]!.text.split(" "));
    const { palette } = before.scene;
    expect(words.every((w) => w.fill === palette.inkMuted)).toBe(true);

    const cue = before.scene.cues[0]!;
    const mid = captionWords(draw((cue.startS + cue.endS) / 2));
    expect(mid.some((w) => w.fill === palette.ink)).toBe(true);
    expect(mid.some((w) => w.fill === palette.inkMuted)).toBe(true);

    const after = captionWords(draw(cue.endS + 0.01));
    expect(after.every((w) => w.fill === palette.ink)).toBe(true);
  });

  it("highlights only the word being said", () => {
    const { scene } = draw(0);
    const word = scene.cues[0]!.words[2]!;
    const highlighted = captionWords(draw((word.startS + word.endS) / 2)).filter((w) => w.fill === scene.palette.highlight);
    expect(highlighted.map((w) => w.text)).toEqual([word.text]);
  });

  const formats = ["9:16", "16:9", "1:1"] as const;
  for (const format of formats) {
    it(`keeps every word inside the frame for ${format}, even a long line`, () => {
      const { width, height } = sizeFor(format, "720p");
      const long = "Honestly I did not expect a tiny grinder like this one to change every single morning of my week but here we are again ".repeat(3).trim();
      const rec = draw(1, { width, height, lines: [{ role: "body", text: long, emotion: "neutral" }], speechS: [10] });
      const { captions } = rec.scene.layout;
      for (const t of rec.texts) {
        const w = rec.ctx.measureText(t.text).width;
        const left = t.align === "center" ? t.x - w / 2 : t.x;
        expect(left, t.text).toBeGreaterThanOrEqual(0);
        expect(left + w, t.text).toBeLessThanOrEqual(width);
        expect(t.y, t.text).toBeLessThanOrEqual(height);
      }
      const words = captionWords(rec);
      expect(words.length).toBe(long.split(" ").length);
      // Shrunk to fit instead of overflowing the caption box.
      expect(fontPx(words[0]!.font)).toBeLessThan(rec.scene.layout.captionSize);
      for (const w of words) {
        expect(w.x + rec.ctx.measureText(w.text).width).toBeLessThanOrEqual(captions.x + captions.width + 0.001);
        expect(w.y).toBeLessThanOrEqual(captions.y + captions.height);
      }
    });
  }

  it("draws the same frame twice for the same time, and moves the background over time", () => {
    const a = draw(1.25);
    const b = draw(1.25);
    expect(b.texts).toEqual(a.texts);
    const calls: number[][] = [];
    const scene = a.scene;
    const rec = recorder(scene.width, scene.height);
    rec.ctx.createRadialGradient = (...args: number[]) => {
      calls.push(args);
      return { addColorStop() {} };
    };
    drawFrame(rec.ctx, scene, 0);
    drawFrame(rec.ctx, scene, 2);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[calls.length / 2]).not.toEqual(calls[0]);
  });
});
