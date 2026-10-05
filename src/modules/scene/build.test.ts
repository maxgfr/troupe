import { describe, expect, it } from "vitest";

import { sizeFor } from "~/modules/models/geometry";
import { buildScene, cueAt, TIMING, type Box, type SceneInput } from "./build";

const actor = { id: "6f1c0e8a-2b7d-4c1e-9a53-0d6e2f4b8c11", name: "Léa Martin" };
const lines: SceneInput["lines"] = [
  { role: "hook", text: "This ended my search for good coffee.", emotion: "excited" },
  { role: "body", text: "Fresh beans, every week.", emotion: "happy" },
  { role: "cta", text: "Grab yours today.", emotion: "calm" },
];

function scene(patch: Partial<SceneInput> = {}) {
  return buildScene({ width: 720, height: 1280, fps: 24, actor, lines, ...patch });
}

function inside(inner: Box, outer: Box) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

function overlap(a: Box, b: Box) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe("buildScene timings", () => {
  it("places each line after the previous one, with the measured speech length", () => {
    const { cues, durationS } = scene({ speechS: [2.5, 1.5, 1.2] });
    expect(cues.map((c) => [c.startS, c.endS])).toEqual([
      [TIMING.leadInS, TIMING.leadInS + 2.5],
      [TIMING.leadInS + 2.5 + TIMING.gapS, TIMING.leadInS + 4 + TIMING.gapS],
      [TIMING.leadInS + 4 + 2 * TIMING.gapS, TIMING.leadInS + 5.2 + 2 * TIMING.gapS],
    ].map(([a, b]) => [expect.closeTo(a!, 6), expect.closeTo(b!, 6)]));
    expect(durationS).toBeCloseTo(TIMING.leadInS + 5.2 + 2 * TIMING.gapS + TIMING.tailS, 6);
  });

  it("estimates speech at 2.5 words per second when it was not measured", () => {
    const { cues } = scene();
    // 7, 4 and 3 words.
    expect(cues.map((c) => c.endS - c.startS)).toEqual([expect.closeTo(7 / 2.5, 6), expect.closeTo(4 / 2.5, 6), expect.closeTo(3 / 2.5, 6)]);
  });

  it("never overlaps two cues and keeps every cue inside the clip", () => {
    const { cues, durationS } = scene({ speechS: [0.1, 3, 0.4] });
    for (const [i, cue] of cues.entries()) {
      expect(cue.startS).toBeGreaterThanOrEqual(0);
      expect(cue.endS).toBeGreaterThan(cue.startS);
      expect(cue.endS).toBeLessThanOrEqual(durationS);
      const next = cues[i + 1];
      if (next) expect(next.startS).toBeGreaterThanOrEqual(cue.endS);
    }
  });

  it("splits each line into words that follow one another and fill the line", () => {
    for (const cue of scene({ speechS: [2.5, 1.5, 1.2] }).cues) {
      expect(cue.words.map((w) => w.text).join(" ")).toBe(cue.text);
      expect(cue.words[0]!.startS).toBeCloseTo(cue.startS, 6);
      expect(cue.words.at(-1)!.endS).toBeCloseTo(cue.endS, 6);
      for (const [i, word] of cue.words.entries()) {
        expect(word.endS).toBeGreaterThan(word.startS);
        if (i > 0) expect(word.startS).toBeCloseTo(cue.words[i - 1]!.endS, 6);
      }
    }
  });

  it("gives longer words more time", () => {
    const [cue] = scene({ lines: [{ role: "hook", text: "a extraordinary", emotion: "neutral" }], speechS: [2] }).cues;
    const [short, long] = cue!.words;
    expect(long!.endS - long!.startS).toBeGreaterThan(short!.endS - short!.startS);
  });

  it("refuses a script without lines and speech lengths that do not match the lines", () => {
    expect(() => scene({ lines: [] })).toThrow(/at least one line/);
    expect(() => scene({ speechS: [1, 2] })).toThrow(/3 lines/);
  });
});

describe("cueAt", () => {
  const s = scene({ speechS: [2, 2, 2] });
  it("shows the first line during the lead-in, then each line until the next one starts", () => {
    expect(cueAt(s, 0)?.index).toBe(0);
    expect(cueAt(s, s.cues[0]!.endS + TIMING.gapS / 2)?.index).toBe(0);
    expect(cueAt(s, s.cues[1]!.startS)?.index).toBe(1);
    expect(cueAt(s, s.durationS)?.index).toBe(2);
  });
});

describe("buildScene layout", () => {
  const formats = ["9:16", "16:9", "1:1"] as const;
  const resolutions = ["480p", "720p", "1080p"] as const;

  for (const format of formats) {
    for (const resolution of resolutions) {
      it(`keeps the actor card and the captions apart and inside a ${format} ${resolution} frame`, () => {
        const { width, height } = sizeFor(format, resolution);
        const { layout } = scene({ width, height });
        const frame = { x: 0, y: 0, width, height };
        expect(inside(layout.card, frame)).toBe(true);
        expect(inside(layout.captions, frame)).toBe(true);
        expect(overlap(layout.card, layout.captions)).toBe(false);
        const { portrait } = layout;
        expect(inside({ x: portrait.cx - portrait.r, y: portrait.cy - portrait.r, width: 2 * portrait.r, height: 2 * portrait.r }, layout.card)).toBe(true);
        // Room for at least two caption lines at the starting size.
        expect(layout.captions.height).toBeGreaterThanOrEqual(2 * layout.captionSize * 1.25);
      });
    }
  }

  it("keeps vertical video clear of the platforms' own buttons and text", () => {
    const { layout } = scene();
    // Bottom fifth: caption and description; right edge: the like/share rail;
    // top tenth: the feed tabs.
    expect(layout.captions.y + layout.captions.height).toBeLessThanOrEqual(1280 * 0.8);
    expect(layout.captions.x + layout.captions.width).toBeLessThanOrEqual(720 * 0.88);
    expect(layout.card.y).toBeGreaterThanOrEqual(1280 * 0.1);
  });

  describe("captions laid over a video", () => {
    for (const format of formats) {
      it(`sits in the lower third of a ${format} frame, below the speaker's face`, () => {
        const { width, height } = sizeFor(format, "720p");
        const { layout } = scene({ width, height });
        const box = layout.overlayCaptions;
        expect(inside(box, { x: 0, y: 0, width, height })).toBe(true);
        expect(box.y).toBeGreaterThanOrEqual(height * 0.6);
        // Room for two lines at the starting size, and a margin at the bottom.
        expect(box.height).toBeGreaterThanOrEqual(2 * layout.captionSize * 1.25);
        expect(box.y + box.height).toBeLessThanOrEqual(height - 0.04 * Math.min(width, height));
      });
    }

    it("keeps vertical video clear of the platforms' own buttons and text too", () => {
      const box = scene().layout.overlayCaptions;
      expect(box.y + box.height).toBeLessThanOrEqual(1280 * 0.8);
      expect(box.x + box.width).toBeLessThanOrEqual(720 * 0.88);
    });

    it("leaves the full frame's layout as it was", () => {
      const { layout } = scene();
      const expected = { x: 43.2, y: 1280 * 0.42, width: 720 * 0.86 - 43.2, height: 1280 * 0.36 };
      for (const [key, value] of Object.entries(expected)) expect(layout.captions[key as keyof typeof expected], key).toBeCloseTo(value, 6);
    });
  });

  it("scales with the frame", () => {
    const small = scene({ width: 480, height: 854 }).layout;
    const large = scene({ width: 1080, height: 1920 }).layout;
    expect(large.captionSize / small.captionSize).toBeCloseTo(1080 / 480, 1);
  });
});

describe("buildScene actor", () => {
  it("takes the initials the portrait shows", () => {
    expect(scene().actor.initials).toBe("LM");
    expect(scene({ actor: { id: "x", name: "" } }).actor.initials).toBe("");
  });
});
