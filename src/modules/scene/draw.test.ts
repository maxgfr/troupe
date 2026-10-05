import { describe, expect, it } from "vitest";

import { sizeFor } from "~/modules/models/geometry";
import { buildScene, type SceneInput } from "./build";
import { drawFrame, portraitShotFor, portraitShots, type SceneContext, type SceneImage, type ScenePortraits } from "./draw";

// Both renderers hand drawFrame a real canvas context: the browser's
// OffscreenCanvas one must fit the interface (the Node one is checked where
// the renderer creates it).
const _browserContextFits = (ctx: OffscreenCanvasRenderingContext2D): SceneContext<ImageBitmap> => ctx;
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
  const rounds: { x: number; y: number; width: number; height: number; radius: number; fill: unknown }[] = [];
  const images: { image: SceneImage; source: number[]; x: number; y: number; width: number; height: number; alpha: number; clipped: boolean }[] = [];
  let clipped = false;
  const gradient = () => ({ addColorStop() {} });
  const ctx: SceneContext = {
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "low",
    save() {},
    restore() {
      clipped = false;
    },
    clip() {
      clipped = true;
    },
    drawImage(image, sx, sy, sw, sh, x, y, width, height) {
      images.push({ image, source: [sx, sy, sw, sh], x, y, width, height, alpha: ctx.globalAlpha, clipped });
    },
    beginPath() {},
    arc() {},
    roundRect(x, y, w, h, radius) {
      rounds.push({ x, y, width: w, height: h, radius, fill: ctx.fillStyle });
    },
    fill() {},
    stroke() {},
    fillRect(x, y, w, h) {
      fills.push({ x, y, width: w, height: h });
    },
    clearRect() {},
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
  return { ctx, texts, fills, rounds, images, width, height };
}

const actor = { id: "6f1c0e8a-2b7d-4c1e-9a53-0d6e2f4b8c11", name: "Léa Martin" };
const lines: SceneInput["lines"] = [
  { role: "hook", text: "This ended my search for good coffee.", emotion: "excited" },
  { role: "cta", text: "Grab yours today.", emotion: "calm" },
];

function draw(t: number, patch: Partial<SceneInput> = {}, portraits?: ScenePortraits) {
  const scene = buildScene({ width: 720, height: 1280, fps: 24, actor, lines, speechS: [2.8, 1.2], ...patch });
  const rec = recorder(scene.width, scene.height);
  drawFrame(rec.ctx, scene, t, portraits ? { portraits } : {});
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

  it("draws the actor card with the initials and the name, and nothing from the script's notes", () => {
    const shown = draw(0.5).texts.map((t) => t.text);
    expect(shown).toContain("LM");
    expect(shown).toContain("Léa Martin");
    // Roles and emotions direct the voice; they are not for the audience.
    expect(shown.join(" ")).not.toMatch(/hook|cta|excited|calm/i);
  });

  it("sizes the card to its content, as a pill around the portrait", () => {
    const { width, height } = sizeFor("16:9", "720p");
    const rec = draw(0.5, { width, height });
    const { layout, palette } = rec.scene;
    const card = rec.rounds.find((r) => r.fill === palette.card)!;
    expect(card.x).toBe(layout.card.x);
    expect(card.width).toBeLessThan(layout.card.width / 2);
    expect(card.radius).toBeCloseTo(card.height / 2, 6);
  });

  it("caps a long name at the card's width", () => {
    const rec = draw(0.5, { actor: { id: actor.id, name: "Maximiliana Alexandrovna Konstantinopoulou-Vanderbilt" } });
    const card = rec.rounds.find((r) => r.fill === rec.scene.palette.card)!;
    expect(card.width).toBeLessThanOrEqual(rec.scene.layout.card.width);
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

  it("puts the word being said, and only it, on a pill in the actor's color", () => {
    const { scene } = draw(0);
    const word = scene.cues[0]!.words[2]!;
    const rec = draw((word.startS + word.endS) / 2);
    const said = captionWords(rec).find((w) => w.text === word.text)!;
    expect(said.fill).toBe(scene.palette.ink);
    const pills = rec.rounds.filter((r) => r.fill === scene.palette.highlight);
    expect(pills).toHaveLength(1);
    const width = rec.ctx.measureText(word.text).width;
    expect(pills[0]!.x).toBeLessThan(said.x);
    expect(pills[0]!.x + pills[0]!.width).toBeGreaterThan(said.x + width);
    // No pill between words or once the line is said.
    expect(draw(scene.cues[0]!.endS + 0.01).rounds.filter((r) => r.fill === scene.palette.highlight)).toHaveLength(0);
  });

  it("balances caption lines instead of leaving a word alone on the last one", () => {
    // Greedy breaking would put "stuff." alone on the second line.
    const text = "Absolutely incredible stuff.";
    const rec = draw(1, { lines: [{ role: "body", text, emotion: "neutral" }], speechS: [4] });
    const rows = new Map<number, string[]>();
    for (const w of captionWords(rec)) rows.set(w.y, [...(rows.get(w.y) ?? []), w.text]);
    expect(rows.size).toBeGreaterThan(1);
    expect([...rows.values()].at(-1)!.length).toBeGreaterThan(1);
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

  describe("captions only, to lay over a video", () => {
    function drawCaptions(t: number) {
      const scene = buildScene({ width: 720, height: 1280, fps: 24, actor, lines, speechS: [2.8, 1.2] });
      const rec = recorder(scene.width, scene.height);
      const cleared: { x: number; y: number; width: number; height: number }[] = [];
      rec.ctx.clearRect = (x, y, width, height) => cleared.push({ x, y, width, height });
      drawFrame(rec.ctx, scene, t, { captionsOnly: true });
      return { ...rec, scene, cleared };
    }

    it("leaves the frame transparent instead of painting the background", () => {
      const rec = drawCaptions(0);
      expect(rec.cleared).toEqual([{ x: 0, y: 0, width: 720, height: 1280 }]);
      expect(rec.fills.some((f) => f.width === 720 && f.height === 1280)).toBe(false);
    });

    it("draws no actor card, only the words of the current line", () => {
      const rec = drawCaptions(0.5);
      const shown = rec.texts.map((t) => t.text);
      expect(shown).not.toContain("LM");
      expect(shown).not.toContain("Léa Martin");
      expect(rec.rounds.some((r) => r.fill === rec.scene.palette.card)).toBe(false);
      expect(shown).toEqual(lines[0]!.text.split(" "));
    });

    it("lights words up like the full frame, in the lower third", () => {
      const word = buildScene({ width: 720, height: 1280, fps: 24, actor, lines, speechS: [2.8, 1.2] }).cues[0]!.words[2]!;
      const t = (word.startS + word.endS) / 2;
      const over = drawCaptions(t);
      const full = captionWords(draw(t));
      const { palette, layout } = over.scene;
      expect(over.texts.map((w) => w.text)).toEqual(full.map((w) => w.text));
      expect(over.rounds.filter((r) => r.fill === palette.highlight)).toHaveLength(1);
      // Words still to come are brighter than on the plain background.
      expect(over.texts.map((w) => w.fill)).toEqual(full.map((w) => (w.fill === palette.inkMuted ? palette.inkMutedOver : w.fill)));
      expect(over.texts.some((w) => w.fill === palette.inkMutedOver)).toBe(true);
      const box = layout.overlayCaptions;
      for (const w of over.texts) {
        expect(w.y).toBeGreaterThanOrEqual(box.y);
        expect(w.y + fontPx(w.font)).toBeLessThanOrEqual(box.y + box.height);
      }
    });

    it("puts a shade behind the caption rows so they read on any picture", () => {
      const rec = drawCaptions(0.5);
      const words = rec.texts;
      const px = fontPx(words[0]!.font);
      // One band, the frame's width, from above the first row to below the last.
      expect(rec.fills).toHaveLength(1);
      const [shade] = rec.fills;
      expect(shade!.x).toBe(0);
      expect(shade!.width).toBe(720);
      expect(shade!.y).toBeLessThan(Math.min(...words.map((w) => w.y)));
      expect(shade!.y + shade!.height).toBeGreaterThan(Math.max(...words.map((w) => w.y)) + px);
      expect(shade!.y).toBeGreaterThanOrEqual(0);
      expect(shade!.y + shade!.height).toBeLessThanOrEqual(1280);
      // Tighter than the whole caption box: the picture shows around it.
      expect(shade!.height).toBeLessThan(rec.scene.layout.captions.height);
    });
  });

  describe("with the actor's portraits", () => {
    // Stand-ins for decoded images: only their size matters to drawFrame.
    const picture = (width = 768, height = 768): SceneImage => ({ width, height });
    const front = picture();
    const excited = picture(512, 512);
    const calm = picture(512, 512);

    it("draws the front portrait in the card's circle instead of the initials", () => {
      const rec = draw(0.1, {}, { front });
      const { portrait } = rec.scene.layout;
      expect(rec.texts.map((t) => t.text)).not.toContain("LM");
      expect(rec.texts.map((t) => t.text)).toContain("Léa Martin");
      expect(rec.images).toHaveLength(1);
      const [drawn] = rec.images;
      expect(drawn!.image).toBe(front);
      expect(drawn!.clipped).toBe(true);
      expect(drawn!.source).toEqual([0, 0, 768, 768]);
      expect(drawn!.x).toBeCloseTo(portrait.cx - portrait.r, 6);
      expect(drawn!.y).toBeCloseTo(portrait.cy - portrait.r, 6);
      expect(drawn!.width).toBeCloseTo(2 * portrait.r, 6);
      expect(drawn!.height).toBeCloseTo(2 * portrait.r, 6);
    });

    it("crops a picture that is not square to its centre", () => {
      const tall = picture(600, 800);
      const [drawn] = draw(0.1, {}, { front: tall }).images;
      expect(drawn!.source).toEqual([0, 100, 600, 600]);
    });

    it("shows the expression of the line being said, and the front portrait for the others", () => {
      const portraits = { front, excited, calm };
      const { scene } = draw(0);
      const [first, second] = scene.cues;
      expect(draw((first!.startS + first!.endS) / 2, {}, portraits).images.map((i) => i.image)).toEqual([excited]);
      expect(draw(second!.endS - 0.01, {}, portraits).images.map((i) => i.image)).toEqual([calm]);
      // No calm picture: the front one.
      expect(draw(second!.endS - 0.01, {}, { front, excited }).images.map((i) => i.image)).toEqual([front]);
      const serious = draw(0.5, { lines: [{ role: "body", text: "Listen.", emotion: "serious" }], speechS: [1] }, portraits);
      expect(serious.images.map((i) => i.image)).toEqual([front]);
    });

    it("cross-fades to the next expression when a line starts", () => {
      const portraits = { front, excited, calm };
      const second = draw(0).scene.cues[1]!;
      const fading = draw(second.startS + 0.05, {}, portraits).images;
      expect(fading.map((i) => i.image)).toEqual([excited, calm]);
      expect(fading[0]!.alpha).toBe(1);
      expect(fading[1]!.alpha).toBeGreaterThan(0);
      expect(fading[1]!.alpha).toBeLessThan(1);
      expect(draw(second.startS + 0.5, {}, portraits).images.map((i) => i.image)).toEqual([calm]);
    });

    it("lays captions over a video without any portrait", () => {
      const scene = buildScene({ width: 720, height: 1280, fps: 24, actor, lines, speechS: [2.8, 1.2] });
      const rec = recorder(scene.width, scene.height);
      drawFrame(rec.ctx, scene, 0.5, { captionsOnly: true, portraits: { front } });
      expect(rec.images).toHaveLength(0);
    });

    it("names the pictures a scene needs: the front one and the lines' expressions", () => {
      expect(portraitShots(draw(0).scene)).toEqual(["front", "excited", "calm"]);
      expect(portraitShots(draw(0, { lines: [{ role: "body", text: "Hi.", emotion: "serious" }], speechS: [1] }).scene)).toEqual(["front"]);
      expect(["neutral", "serious", "disappointed"].map((e) => portraitShotFor(e as "neutral"))).toEqual(["front", "front", "front"]);
      expect(["happy", "calm", "excited"].map((e) => portraitShotFor(e as "happy"))).toEqual(["happy", "calm", "excited"]);
    });
  });

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
