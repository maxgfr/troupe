// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import type { ModelOptionView } from "../model-choice";
import { LaunchPanel } from "./launch-panel";

// Compare is offered when two models can render the script, and when it is
// not, the panel says why instead of leaving the button out without a word.
afterEach(cleanup);

const option = (key: string, durationsS = [4, 8, 10]): ModelOptionView => ({
  key, label: key, vendor: "v", kind: "local",
  capabilities: { aspectRatios: ["9:16"], resolutions: ["720p"], durationsS, audio: "always", dialogueLanguages: null },
  defaults: { resolution: "720p", durationS: 8, audio: true },
  pricePerSecondUsd: 0, available: true, unavailableReason: null, compatible: true, warnings: [],
});
const panel = (options: ModelOptionView[]) =>
  render(<LaunchPanel options={options} model={options[0]!} estimatedS={8} busy={false} onModel={vi.fn()} onLaunch={vi.fn()} onCompare={vi.fn()} />);

it("offers Compare with two models that hold the script", () => {
  panel([option("Renderer"), option("Renderer B")]);
  expect(screen.getByRole("button", { name: "Compare 2 models" })).toBeDefined();
});

it("says why Compare is not offered", () => {
  panel([option("Renderer")]);
  expect(screen.queryByRole("button", { name: /^Compare/ })).toBeNull();
  expect(screen.getByText(/^Comparing needs at least two models/)).toBeDefined();
  cleanup();
  panel([option("Renderer"), option("AI video", [5])]);
  expect(screen.getByText(/^Comparing needs at least two models/)).toBeDefined();
});
