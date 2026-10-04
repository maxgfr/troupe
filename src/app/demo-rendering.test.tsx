// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditionProvider, type Edition } from "./_components/edition";
import { GenerationTimeline, type GenerationRow } from "./(app)/projects/[projectId]/generation-timeline";
import { LaunchPanel } from "./(app)/projects/[projectId]/launch-panel";
import type { ModelOptionView } from "./(app)/projects/model-choice";

// The demo renders with its own model, in the page: the project page shows
// that model's live progress and what a render there takes.

afterEach(cleanup);

const demo: Edition = {
  kind: "demo",
  resetData: async () => {},
  rendering: {
    modelKey: "browser",
    LaunchNote: () => <p>Note about rendering here</p>,
    Progress: ({ providerJobId }) => <p>Progress of {providerJobId}</p>,
  },
};

function inDemo(node: React.ReactNode) {
  return render(<EditionProvider value={demo}>{node}</EditionProvider>);
}

const row = (patch: Partial<GenerationRow>): GenerationRow => ({
  id: "g1", provider: "browser", modelId: "Kokoro voice + captions", modelKey: "browser", providerJobId: "job-1",
  tier: "draft", status: "in_progress", durationS: 6, createdAt: new Date(), ...patch,
});

const option = (patch: Partial<ModelOptionView>): ModelOptionView => ({
  key: "browser", label: "Kokoro voice + captions", vendor: "This browser", kind: "local",
  capabilities: { aspectRatios: ["9:16"], resolutions: ["720p"], durationsS: [6, 8], audio: "always", dialogueLanguages: ["en"] },
  defaults: { resolution: "720p", durationS: 6, audio: true }, pricePerSecondUsd: 0,
  available: true, unavailableReason: null, compatible: true, warnings: [], ...patch,
});

const panel = { estimatedS: 4, busy: false, onModel: vi.fn(), onLaunch: vi.fn(), onCompare: vi.fn() };

describe("demo rendering on the project page", () => {
  it("shows the live progress of a render running in this browser", () => {
    inDemo(<GenerationTimeline generations={[row({})]} />);
    expect(screen.getByText("Progress of job-1")).toBeDefined();
  });

  it("keeps the generic bar for other models and for jobs not yet accepted", () => {
    const { container } = inDemo(
      <GenerationTimeline generations={[row({ id: "g2", modelKey: "veo-3.1-fast" }), row({ id: "g3", providerJobId: null })]} />,
    );
    expect(screen.queryByText(/Progress of/)).toBeNull();
    expect(container.querySelectorAll(".progress-glow")).toHaveLength(2);
  });

  it("invites a first render instead of promising one later", () => {
    inDemo(<GenerationTimeline generations={[]} />);
    expect(screen.getByText(/It renders in this tab/)).toBeDefined();
  });

  it("says where the render runs and what it takes, before any launch", () => {
    const model = option({});
    inDemo(<LaunchPanel {...panel} options={[model]} model={model} />);
    expect(screen.getByText("Note about rendering here")).toBeDefined();
    expect(screen.getByText("Runs in this browser.")).toBeDefined();
  });

  it("explains why this browser cannot render, with the way out", () => {
    const blocked = option({ available: false, unavailableReason: "This browser cannot render video. This browser has no WebCodecs encoder." });
    inDemo(<LaunchPanel {...panel} options={[blocked]} model={null} />);
    expect(screen.getByText(/has no WebCodecs encoder/)).toBeDefined();
    expect(screen.getByRole("link", { name: /run Troupe on your machine/ })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Launch draft" })).toBeNull();
  });
});
