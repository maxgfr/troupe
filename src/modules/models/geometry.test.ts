import { describe, expect, it } from "vitest";

import { framesFor, sizeFor } from "./geometry";

describe("sizeFor", () => {
  it("maps a resolution to its short side and the aspect ratio to the long side", () => {
    expect(sizeFor("9:16", "720p")).toEqual({ width: 720, height: 1280 });
    expect(sizeFor("16:9", "720p")).toEqual({ width: 1280, height: 720 });
    expect(sizeFor("1:1", "1080p")).toEqual({ width: 1080, height: 1080 });
  });

  it("rounds to the model's pixel multiple", () => {
    expect(sizeFor("16:9", "480p", { multiple: 16 })).toEqual({ width: 848, height: 480 });
    expect(sizeFor("16:9", "480p", { multiple: 32 })).toEqual({ width: 864, height: 480 });
  });

  it("prefers an explicit size table", () => {
    expect(sizeFor("9:16", "720p", { table: { "9:16@720p": [704, 1280] } })).toEqual({ width: 704, height: 1280 });
  });

  it("rejects unknown inputs", () => {
    expect(() => sizeFor("4:3", "720p")).toThrow(/4:3/);
    expect(() => sizeFor("9:16", "8k")).toThrow(/8k/);
  });
});

describe("framesFor", () => {
  it("returns duration × fps for free frame counts", () => {
    expect(framesFor(5, 24, "any")).toBe(120);
  });

  it("snaps to 4n+1 and 8n+1 rules", () => {
    expect(framesFor(5, 16, "4n+1")).toBe(81);
    expect(framesFor(5, 24, "8n+1")).toBe(121);
    expect(framesFor(4, 24, "8n+1")).toBe(97);
  });
});
