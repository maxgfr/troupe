import { describe, expect, it } from "vitest";

import { overallProgress } from "./protocol";

describe("overallProgress", () => {
  it("runs from voicing to the last frame, never backwards", () => {
    const steps = [
      overallProgress({ stage: "queued" }),
      overallProgress({ stage: "voice", line: 0, lines: 3, device: "webgpu" }),
      overallProgress({ stage: "voice", line: 3, lines: 3, device: "webgpu" }),
      overallProgress({ stage: "frames", frame: 0, frames: 144 }),
      overallProgress({ stage: "frames", frame: 72, frames: 144 }),
      overallProgress({ stage: "saving" }),
    ];
    expect(steps.map((p) => Math.round(p * 100))).toEqual([0, 0, 30, 30, 65, 100]);
  });
});
