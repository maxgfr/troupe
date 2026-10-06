// @vitest-environment jsdom
// The product-polish behaviour of the pure views: render progress, real
// lengths, captions a video already shows, one relaunch, download names, the
// too-long script flagged while typing, empty actor states and Settings
// pointing at its own key form.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/trpc/react", () => ({ api: { useUtils: () => ({}) } }));

import { GenerationTimeline, type GenerationRow } from "./(app)/projects/[projectId]/generation-timeline";
import { ScriptComposer } from "./(app)/projects/[projectId]/script/script-composer";
import { ActorStep } from "./(app)/projects/new/wizard-steps";
import { ActorGrid } from "./(app)/actors/actor-grid";
import { ModelCatalogList, type CatalogModelView } from "./(app)/settings/model-catalog";
import { BenchmarkCompare } from "./(app)/benchmark/benchmark-compare";

afterEach(cleanup);

const prompt = "UGC-style ad.\nDialogue:\n[excited] (hook) Spring is here.\n[neutral] (cta) Tap the link.";
const row = (patch: Partial<GenerationRow>): GenerationRow => ({
  id: "g1",
  provider: "http",
  modelId: "Renderer",
  modelLabel: "Local renderer",
  tier: "draft",
  status: "completed",
  durationS: 10,
  createdAt: new Date(2026, 9, 5, 9, 45),
  outputAssetUrl: "/api/media/a1",
  prompt,
  ...patch,
});

describe("render timeline", () => {
  it("fills the bar with the progress the model reports, and glows half full without one", () => {
    render(
      <GenerationTimeline
        generations={[
          row({ id: "a", status: "in_progress", progress: 0.42, outputAssetUrl: null }),
          row({ id: "b", status: "in_progress", progress: null, outputAssetUrl: null }),
        ]}
      />,
    );
    const [known, unknown] = screen.getAllByRole("progressbar");
    expect(known!.getAttribute("aria-valuenow")).toBe("42");
    expect(known!.getAttribute("aria-valuetext")).toBe("Progress, 42%");
    expect(unknown!.getAttribute("aria-valuenow")).toBeNull();
  });

  it("shows the video's real length once saved, the clip length before", () => {
    render(
      <GenerationTimeline
        generations={[
          row({ id: "a", mediaDurationS: 13.166667 }),
          row({ id: "b", status: "in_progress", outputAssetUrl: null, mediaDurationS: null }),
        ]}
      />,
    );
    expect(screen.getByText(/Local renderer · 13\.2 s/)).toBeDefined();
    expect(screen.getByText(/Local renderer · 10 s/)).toBeDefined();
  });

  it("keeps the player's captions off for a video that shows its own, on otherwise", () => {
    const { container, rerender } = render(
      <GenerationTimeline generations={[row({ burnedCaptions: true, mediaDurationS: 13.2 })]} />,
    );
    const track = () => container.querySelector("track")!;
    expect(track().hasAttribute("default")).toBe(false);
    // The track stays available, timed on the real length.
    expect(decodeURIComponent(track().getAttribute("src")!)).toContain("00:00:13.000");
    rerender(<GenerationTimeline generations={[row({ burnedCaptions: false })]} />);
    expect(track().hasAttribute("default")).toBe(true);
  });

  it("offers one relaunch per failure", () => {
    const onRelaunch = vi.fn();
    render(
      <GenerationTimeline
        onRelaunch={onRelaunch}
        generations={[
          row({ id: "new", status: "in_progress", outputAssetUrl: null }),
          row({ id: "old", status: "failed", relaunched: true, outputAssetUrl: null }),
        ]}
      />,
    );
    expect(screen.queryByRole("button", { name: "Relaunch" })).toBeNull();
    expect(screen.getByText("Relaunched")).toBeDefined();
  });

  it("names downloads after the project, the model and the time, and links the newest video to its export", () => {
    render(<GenerationTimeline projectId="p1" projectTitle="Spring drop" generations={[row({ tier: "final" })]} />);
    expect(screen.getByRole("link", { name: "Download MP4" }).getAttribute("href")).toBe(
      "/api/media/a1?download=spring-drop-local-renderer-2026-10-05-0945.mp4",
    );
    expect(screen.getByRole("link", { name: "Export this video" }).getAttribute("href")).toBe(
      "/projects/p1/export?render=g1",
    );
    expect(screen.getByText("final")).toBeDefined();
  });
});

describe("script composer", () => {
  it("flags a script longer than the model's longest clip while it is typed", () => {
    render(
      <ScriptComposer
        pending={false}
        enabled
        initialText=""
        limit={{ seconds: 8, modelLabel: "Local renderer" }}
        onSave={() => undefined}
      />,
    );
    const field = screen.getByLabelText(/Write or paste your script/);
    fireEvent.change(field, { target: { value: "Short and sweet." } });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText(/≈2 s spoken of 8 s/)).toBeDefined();
    // 25 words: about 10 s to say.
    fireEvent.change(field, {
      target: {
        value:
          "This line is far too long for an eight second clip because it keeps going and going and going until the viewer has scrolled away.",
      },
    });
    expect(screen.getByRole("status").textContent).toBe(
      "This takes about 10 s to say, but Local renderer renders at most 8 s. Cut a few words, or pick another model on the Video tab.",
    );
  });
});

describe("empty actor states", () => {
  it("explains an empty library in the wizard, and when no actor can be picked", () => {
    const { rerender } = render(<ActorStep pending={false} actors={[]} actorId={null} onActor={() => undefined} />);
    expect(screen.getByText("No actors in the library yet")).toBeDefined();
    rerender(
      <ActorStep
        pending={false}
        actors={[{ id: "a", name: "Léa", style: "casual", ageRange: "25-34", status: "unavailable" }]}
        actorId={null}
        onActor={() => undefined}
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/Every actor is unavailable/);
  });

  it("tells an empty library from a filter that matches nobody", () => {
    const { rerender } = render(<ActorGrid actors={[]} />);
    expect(screen.getByText("The actor library is empty")).toBeDefined();
    rerender(<ActorGrid actors={[]} filtered />);
    expect(screen.getByText("No actor matches this filter")).toBeDefined();
  });
});

describe("settings", () => {
  it("sends a cloud model without a key to Provider accounts on the same page", () => {
    const veo: CatalogModelView = {
      key: "veo",
      label: "Veo 3.1 Fast",
      vendor: "Google",
      kind: "cloud",
      credential: "google",
      capabilities: { resolutions: ["720p"], durationsS: [8], audio: "always" },
      defaults: { resolution: "720p", durationS: 8, audio: true },
      pricePerSecondUsd: 0.15,
      timeoutS: 1800,
      enabled: true,
      archived: false,
      status: "missing-credentials",
      statusDetail: "Add a Google AI key in Settings.",
    };
    render(
      <ModelCatalogList
        models={[veo]}
        reports={{}}
        onToggle={() => undefined}
        onTest={() => undefined}
        onSave={() => undefined}
      />,
    );
    expect(screen.queryByText(/in Settings/)).toBeNull();
    expect(screen.getByRole("link", { name: "Provider accounts" }).getAttribute("href")).toBe("#provider-accounts");
  });
});

describe("benchmark", () => {
  it("caps the player like the project page and keeps captions off for burned-in ones", () => {
    const { container } = render(
      <BenchmarkCompare
        entries={[
          { id: "e", modelKey: "r", status: "completed", outputAssetUrl: "/api/media/x", burnedCaptions: true },
        ]}
        briefLines={["Hello there."]}
      />,
    );
    expect(container.querySelector("video")!.className).toContain("max-h-[420px]");
    expect(container.querySelector("track")!.hasAttribute("default")).toBe(false);
  });

  it("times the captions on the video's real length and shows that length", () => {
    const { container } = render(
      <BenchmarkCompare
        entries={[
          {
            id: "e",
            modelKey: "r",
            status: "completed",
            outputAssetUrl: "/api/media/x",
            durationS: 10,
            mediaDurationS: 13.166667,
          },
        ]}
        briefLines={["Hello there."]}
      />,
    );
    expect(decodeURIComponent(container.querySelector("track")!.getAttribute("src")!)).toContain("00:00:13.000");
    expect(screen.getByText("13.2 s")).toBeDefined();
  });
});
