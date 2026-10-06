import { describe, expect, it } from "vitest";
import { catalogOf, fakeAdapter } from "~/test/adapters";
import { modelOptionsFor } from "~/modules/studio";

const veo = fakeAdapter({
  modelKey: "veo",
  capabilities: { aspectRatios: ["9:16", "16:9"], audio: "always", dialogueLanguages: ["en"] },
});
const kling = fakeAdapter({
  modelKey: "kling",
  capabilities: { aspectRatios: ["9:16", "16:9", "1:1"], dialogueLanguages: ["en", "zh"] },
});
const wan = fakeAdapter({ modelKey: "wan", capabilities: { audio: "none" } });

describe("model options for a project", () => {
  it("offers enabled models with their format compatibility", () => {
    const { models } = catalogOf([veo, kling]);
    const options = modelOptionsFor(models, { format: "1:1" });
    expect(options.map((o) => [o.key, o.compatible, o.available])).toEqual([
      ["veo", false, true],
      ["kling", true, true],
    ]);
    expect(options[0]!.warnings[0]).toMatch(/9:16 and 16:9 only/);
  });

  it("warns about untried dialogue languages and silent models", () => {
    const { models } = catalogOf([veo, wan]);
    const [veoOption, wanOption] = modelOptionsFor(models, { format: "9:16", language: "fr" });
    expect(veoOption!.warnings.join(" ")).toMatch(/only been tried with English dialogue; French/);
    expect(wanOption!.warnings.join(" ")).toMatch(/silent video/);
  });

  it("hides disabled and archived models and explains unavailable ones", () => {
    const { models } = catalogOf([veo, kling, wan], {
      patch: {
        veo: { enabled: false },
        wan: { archived: true },
        kling: { status: "missing-credentials", statusDetail: "Add a fal.ai key in Settings." },
      },
    });
    expect(modelOptionsFor(models, {}).map((o) => [o.key, o.available, o.unavailableReason])).toEqual([
      ["kling", false, "Add a fal.ai key in Settings."],
    ]);
  });
});
