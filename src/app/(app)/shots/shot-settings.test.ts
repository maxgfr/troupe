import { describe, expect, it } from "vitest";

import {
  cssRatio,
  estimateUsd,
  matchModels,
  parseMemory,
  selectionKey,
  settingsFor,
  sharedCapabilities,
} from "./shot-settings";

const CAPS = {
  aspectRatios: ["16:9", "9:16"],
  resolutions: ["720p", "1080p"],
  durationsS: [4, 6, 8],
  audio: "optional" as const,
};
const DEFAULTS = { resolution: "720p", durationS: 8, audio: true };

describe("settingsFor", () => {
  it("starts on the model's defaults, vertical when it can", () => {
    expect(settingsFor(CAPS, DEFAULTS)).toEqual({ aspectRatio: "9:16", durationS: 8, resolution: "720p", audio: true });
  });

  it("keeps the settings last used on the model while it still takes them", () => {
    expect(
      settingsFor(CAPS, DEFAULTS, { aspectRatio: "16:9", durationS: 4, resolution: "1080p", audio: false }),
    ).toEqual({ aspectRatio: "16:9", durationS: 4, resolution: "1080p", audio: false });
  });

  it("drops a saved value the model no longer takes", () => {
    expect(settingsFor(CAPS, DEFAULTS, { aspectRatio: "1:1", durationS: 10 })).toMatchObject({
      aspectRatio: "9:16",
      durationS: 8,
    });
  });

  it("follows a model that always or never makes sound", () => {
    expect(settingsFor({ ...CAPS, audio: "always" }, DEFAULTS, { audio: false }).audio).toBe(true);
    expect(settingsFor({ ...CAPS, audio: "none" }, DEFAULTS, { audio: true }).audio).toBe(false);
  });
});

describe("sharedCapabilities", () => {
  const kling = { key: "kling", label: "Kling 3.0", capabilities: { ...CAPS, durationsS: [4, 8, 10] } };
  const veo = {
    key: "veo",
    label: "Veo 3.1",
    capabilities: { aspectRatios: ["16:9", "9:16"], resolutions: ["720p"], durationsS: [8], audio: "always" as const },
  };

  it("offers what every chosen model renders", () => {
    expect(sharedCapabilities([kling, veo])).toEqual({
      capabilities: { aspectRatios: ["16:9", "9:16"], resolutions: ["720p"], durationsS: [8], audio: "optional" },
      missing: null,
      soundPerModel: true,
    });
  });

  it("is one model's own choices when only one is chosen", () => {
    expect(sharedCapabilities([kling])).toMatchObject({ capabilities: kling.capabilities, soundPerModel: false });
    expect(sharedCapabilities([])).toBeNull();
  });

  it("says in a sentence what the models do not share", () => {
    const square = { key: "sq", label: "Square", capabilities: { ...CAPS, aspectRatios: ["1:1"] } };
    expect(sharedCapabilities([kling, square])?.missing).toBe(
      "Kling 3.0 and Square share no format. Choose other models.",
    );
    const short = { key: "short", label: "Short", capabilities: { ...CAPS, durationsS: [5] } };
    expect(sharedCapabilities([veo, short])?.missing).toBe(
      "Veo 3.1 and Short share no clip length. Choose other models.",
    );
  });
});

describe("the composer's helpers", () => {
  it("estimates the price of every render asked for, on every priced model", () => {
    expect(estimateUsd([0.1], 5, 2)).toBeCloseTo(1);
    expect(estimateUsd([0.1, 0.3, null], 5, 2)).toBeCloseTo(4);
    expect(estimateUsd([null], 5, 2)).toBeNull();
  });

  it("turns a format into a CSS ratio", () => {
    expect(cssRatio("16:9")).toBe("16 / 9");
    expect(cssRatio("nonsense")).toBe("9 / 16");
  });

  it("reads back what it saved, and ignores anything else", () => {
    expect(parseMemory(JSON.stringify({ text: "Dawn", modelKeys: ["kling", "veo", "kling"], count: 9 }))).toMatchObject(
      {
        text: "Dawn",
        modelKeys: ["kling", "veo"],
        count: 1,
      },
    );
    // What the first version kept: one model.
    expect(parseMemory(JSON.stringify({ modelKey: "kling" })).modelKeys).toEqual(["kling"]);
    expect(parseMemory("{not json")).toMatchObject({ text: "", modelKeys: [] });
  });

  it("keeps a selection's settings under one key, whatever the order", () => {
    expect(selectionKey(["veo", "kling"])).toBe(selectionKey(["kling", "veo"]));
  });

  it("finds models by every word of the search", () => {
    const models = [
      { key: "veo-3.1-fast", label: "Veo 3.1 Fast", vendor: "Google" },
      { key: "kling-3.0", label: "Kling 3.0", vendor: "fal.ai" },
    ];
    expect(matchModels(models, "veo fast").map((m) => m.key)).toEqual(["veo-3.1-fast"]);
    expect(matchModels(models, "FAL").map((m) => m.key)).toEqual(["kling-3.0"]);
    expect(matchModels(models, "  ")).toHaveLength(2);
  });
});
