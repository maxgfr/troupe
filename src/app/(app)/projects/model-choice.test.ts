import { describe, expect, it } from "vitest";

import { comparisonPlan, formatCost, launchSettings, pickModel, type ModelOptionView } from "./model-choice";

const option = (key: string, patch: Partial<ModelOptionView> = {}, caps: Partial<ModelOptionView["capabilities"]> = {}): ModelOptionView => ({
  key, label: key, vendor: "v", kind: "cloud",
  capabilities: { aspectRatios: ["9:16"], resolutions: ["720p"], durationsS: [4, 6, 8], audio: "always", dialogueLanguages: null, ...caps },
  defaults: { resolution: "720p", durationS: 8, audio: true },
  pricePerSecondUsd: null, available: true, unavailableReason: null, compatible: true, warnings: [],
  ...patch,
});

describe("pickModel", () => {
  const options = [option("veo"), option("kling", { compatible: false }), option("seedance")];

  it("keeps the project's choice, else the studio default, else the first usable model", () => {
    expect(pickModel(options, "seedance", "veo")?.key).toBe("seedance");
    expect(pickModel(options, "kling", "seedance")?.key).toBe("seedance");
    expect(pickModel(options, null, null)?.key).toBe("veo");
    expect(pickModel([option("x", { available: false })], null, null)).toBeNull();
  });
});

describe("launchSettings", () => {
  it("offers only clip lengths long enough for the script, preselecting the model's default when it fits", () => {
    const s = launchSettings(option("veo"), 5);
    expect(s.durations).toEqual([6, 8]);
    // The default saved in Settings (8 s) is honoured whenever the script fits it.
    expect(s.durationS).toBe(8);
    expect(launchSettings(option("veo"), 5, { durationS: 6 }).durationS).toBe(6);
    // A script longer than the default gets the shortest clip that fits.
    expect(launchSettings(option("veo", { defaults: { resolution: "720p", durationS: 4, audio: true } }), 5).durationS).toBe(6);
  });

  it("flags a script longer than the longest clip", () => {
    expect(launchSettings(option("veo"), 12)).toMatchObject({ tooLong: true, durationS: null, longestS: 8 });
  });

  it("shows the audio switch only when audio is optional", () => {
    expect(launchSettings(option("veo"), 2).audioToggle).toBe(false);
    const kling = option("kling", {}, { audio: "optional" });
    expect(launchSettings(kling, 2, { audio: false })).toMatchObject({ audioToggle: true, audio: false });
    expect(launchSettings(option("wan", {}, { audio: "none" }), 2).audio).toBe(false);
  });
});

describe("comparisonPlan", () => {
  it("finds a clip length and resolution every compared model accepts", () => {
    const plan = comparisonPlan([option("veo"), option("kling", {}, { durationsS: [5, 8, 10] }), option("seedance", {}, { resolutions: ["480p", "720p"] })], 6);
    expect(plan).toEqual({ ok: true, modelKeys: ["veo", "kling", "seedance"], durationS: 8, resolution: "720p" });
  });

  it("picks the first model's default length when every compared model offers it and the script fits, as Launch does", () => {
    const veo = option("veo");
    expect(comparisonPlan([veo, option("kling")], 5)).toMatchObject({ ok: true, durationS: launchSettings(veo, 5).durationS });
    expect(comparisonPlan([veo, option("kling")], 5)).toMatchObject({ durationS: 8 });
    // A default the others lack falls back to the shortest shared length.
    expect(comparisonPlan([veo, option("kling", {}, { durationsS: [6, 10] })], 5)).toMatchObject({ durationS: 6 });
  });

  it("drops the last model when three share nothing, and explains when nothing fits", () => {
    expect(comparisonPlan([option("a"), option("b"), option("c", {}, { durationsS: [5] })], 2)).toMatchObject({ ok: true, modelKeys: ["a", "b"] });
    expect(comparisonPlan([option("a")], 2)).toMatchObject({ ok: false });
  });
});

describe("formatCost", () => {
  it("marks estimates and local renders", () => {
    expect(formatCost(1.2, "estimate")).toBe("$1.20 est.");
    expect(formatCost(0, "estimate")).toBe("free (local)");
    expect(formatCost(2.4, "provider")).toBe("$2.40");
    expect(formatCost(null, null)).toBe("—");
  });
});
