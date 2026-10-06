import { describe, expect, it } from "vitest";

import { cheapestPlan, money, planTotal } from "./live.ts";

const caps = (
  over: Partial<{
    aspectRatios: string[];
    resolutions: string[];
    durationsS: number[];
    audio: "always" | "optional" | "none";
  }> = {},
) => ({
  aspectRatios: ["9:16"],
  resolutions: ["720p"],
  durationsS: [3, 5, 10],
  audio: "optional" as const,
  dialogueLanguages: null,
  ...over,
});

describe("troupe doctor --live's plan", () => {
  it("prices the clip it launches, silent and at the lowest resolution, as pnpm verify:live does", () => {
    const kling = cheapestPlan({
      key: "kling-3.0",
      label: "Kling 3.0",
      kind: "cloud",
      capabilities: caps(),
      pricePerSecondUsd: 0.126,
    });
    expect(kling).toMatchObject({ durationS: 3, resolution: "720p", audio: false, estimateUsd: 0.25 });
    const seedance = cheapestPlan({
      key: "seedance-1.5-pro",
      label: "Seedance 1.5 Pro",
      kind: "cloud",
      capabilities: caps({ resolutions: ["480p", "720p", "1080p"], durationsS: [4, 5] }),
      pricePerSecondUsd: 0.052,
    });
    expect(seedance).toMatchObject({ resolution: "480p", estimateUsd: 0.05 });
  });

  it("says a cloud model without a price costs an unknown amount, never that it is free", () => {
    const plan = cheapestPlan({
      key: "veo-next",
      label: "Veo next",
      kind: "cloud",
      capabilities: caps({ audio: "always" }),
      pricePerSecondUsd: null,
    });
    expect(plan.estimateUsd).toBeNull();
    expect(money(plan.estimateUsd)).toBe("price unknown");
    expect(planTotal([plan])).toEqual({ usd: 0, unknown: ["Veo next"] });
    expect(
      money(
        cheapestPlan({ key: "local-a", label: "Mine", kind: "local", capabilities: caps(), pricePerSecondUsd: 0 })
          .estimateUsd,
      ),
    ).toBe("free");
  });
});
