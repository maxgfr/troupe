import { describe, expect, it } from "vitest";

import { actorHue, oklch, paletteFor } from "./palette";

describe("actorHue", () => {
  it("is a stable hue in [0, 360) per actor id", () => {
    const id = "6f1c0e8a-2b7d-4c1e-9a53-0d6e2f4b8c11";
    expect(actorHue(id)).toBe(actorHue(id));
    expect(actorHue(id)).toBe([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));
    for (const sample of ["", "a", id, "zzzzzzzzzzzzzzzz"]) {
      expect(actorHue(sample)).toBeGreaterThanOrEqual(0);
      expect(actorHue(sample)).toBeLessThan(360);
    }
  });
});

describe("oklch", () => {
  it("converts to the sRGB hex a browser would paint", () => {
    expect(oklch(1, 0, 0)).toBe("#ffffff");
    expect(oklch(0, 0, 0)).toBe("#000000");
    expect(oklch(0.628, 0.2577, 29.23)).toBe("#ff0000");
    expect(oklch(0.8664, 0.2948, 142.5)).toBe("#00ff00");
  });

  it("clips colors outside sRGB instead of wrapping", () => {
    expect(oklch(0.7, 0.4, 150)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("adds an alpha channel when asked", () => {
    expect(oklch(1, 0, 0, 0.5)).toBe("rgba(255, 255, 255, 0.5)");
  });
});

describe("paletteFor", () => {
  it("paints the portrait like ActorPortrait does", () => {
    const hue = actorHue("abc");
    const palette = paletteFor("abc");
    expect(palette.portrait).toBe(oklch(0.3, 0.05, hue));
    expect(palette.portraitInk).toBe(oklch(0.92, 0.02, hue));
  });

  it("gives different actors different colors", () => {
    // Hues 263 and 347.
    const a = paletteFor("6f1c0e8a-2b7d-4c1e-9a53-0d6e2f4b8c11");
    const b = paletteFor("0b9e7f24-3c5a-4d8e-8f61-2a7c9d1e4b30");
    expect(a.backgroundTop).not.toBe(b.backgroundTop);
    expect(a.highlight).not.toBe(b.highlight);
  });
});
