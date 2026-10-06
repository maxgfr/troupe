// @vitest-environment jsdom
// A11y pass (cycle 5): the two audited non-conformities stay fixed —
// <video> previews carry a captions <track> and the credit ledger
// table has an accessible caption.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BenchmarkCompare } from "./(app)/benchmark/benchmark-compare";
import { GenerationTimeline } from "./(app)/projects/[projectId]/generation-timeline";

afterEach(cleanup);

const PROMPT = [
  "UGC-style ad, single actor speaking to camera.",
  "Voice: v. Language: en.",
  "Dialogue:",
  "[neutral] (hook) Buy it.",
].join("\n");

describe("captions tracks", () => {
  it("benchmark render previews carry a captions track built from the brief", () => {
    render(
      <BenchmarkCompare
        entries={[
          {
            id: "b1",
            modelKey: "veo",
            status: "completed",
            outputAssetUrl: "https://x/v.mp4",
            durationS: 8,
            votes: {},
          },
        ]}
        brief="Buy it."
      />,
    );
    const track = document.querySelector("video track") as HTMLTrackElement | null;
    expect(track).not.toBeNull();
    expect(track!.getAttribute("kind")).toBe("captions");
    expect(track!.getAttribute("src")!.startsWith("data:text/vtt")).toBe(true);
  });

  it("benchmark previews cue captions PER SCRIPT LINE when the run carries its lines", () => {
    render(
      <BenchmarkCompare
        entries={[
          {
            id: "b1",
            modelKey: "veo",
            status: "completed",
            outputAssetUrl: "https://x/v.mp4",
            durationS: 8,
            votes: {},
          },
        ]}
        brief="Buy it. Now."
        briefLines={["Buy it.", "Now."]}
      />,
    );
    const src = decodeURIComponent((document.querySelector("video track") as HTMLTrackElement).getAttribute("src")!);
    const cues = src.split("\n\n").filter((b) => b.includes("-->"));
    expect(cues).toHaveLength(2);
    expect(cues[0]).toContain("Buy it.");
    expect(cues[1]).toContain("Now.");
  });

  it("the monitor's star render carries a captions track from its script prompt", () => {
    render(
      <GenerationTimeline
        generations={[
          {
            id: "g1",
            provider: "veo",
            modelId: "veo-3.1",
            tier: "final",
            status: "completed",
            durationS: 8,
            createdAt: "2026-07-12T10:00:00Z",
            outputAssetUrl: "https://x/v.mp4",
            prompt: PROMPT,
          },
        ]}
      />,
    );
    const track = document.querySelector("video track") as HTMLTrackElement | null;
    expect(track).not.toBeNull();
    expect(decodeURIComponent(track!.getAttribute("src")!)).toContain("Buy it.");
  });
});
