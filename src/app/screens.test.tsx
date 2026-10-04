// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The pure views (data in via props, decisions out via callbacks) render
// without any tRPC. The client is stubbed only because the page files import
// it at module level.
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({}),
    identity: { myWorkspaces: { useQuery: () => ({ isPending: true }) }, projects: { useQuery: () => ({ isPending: true }) } },
    actors: { list: { useQuery: () => ({ isPending: true }) } },
    studio: { formatOptions: { useQuery: () => ({ isPending: true }) }, providersFor: { useQuery: () => ({ isPending: true }) }, getProject: { useQuery: () => ({ isPending: true }) }, createFromWizard: { useMutation: () => ({}) }, updateChoices: { useMutation: () => ({}) } },
    script: { history: { useQuery: () => ({ isPending: true }) }, paste: { useMutation: () => ({}) }, setLineEmotion: { useMutation: () => ({}) } },
    generation: { forProject: { useQuery: () => ({ isPending: true }) }, launchText: { useMutation: () => ({}) } },
    benchmark: { start: { useMutation: () => ({}) }, get: { useQuery: () => ({ isPending: true }) }, vote: { useMutation: () => ({}) } },
    export: { checkSpecs: { useQuery: () => ({ isPending: true }) }, create: { useMutation: () => ({}) } },
  },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

import { DashboardView } from "./(app)/dashboard/dashboard-view";
import { ActorGrid } from "./(app)/actors/actor-grid";
import { ScriptLines } from "./(app)/projects/[projectId]/script/script-lines";
import { GenerationTimeline } from "./(app)/projects/[projectId]/generation-timeline";
import { BenchmarkCompare } from "./(app)/benchmark/benchmark-compare";
import { WizardStepper } from "./(app)/projects/new/wizard-stepper";

afterEach(cleanup);

describe("Dashboard", () => {
  it("teaches the first action when there is no project", () => {
    render(<DashboardView projects={[]} />);
    expect(screen.getByText("Create your first project")).toBeDefined();
    expect(screen.getByRole("link", { name: "New project" })).toBeDefined();
  });

  it("lists projects with their status chip", () => {
    render(
      <DashboardView
        projects={[{ id: "p1", title: "Spring drop", platform: "tiktok", format: "9:16", status: "scripting" }]}
      />,
    );
    expect(screen.getByText("Spring drop")).toBeDefined();
    expect(screen.getByText("scripting")).toBeDefined();
  });
});

describe("Actor library", () => {
  it("labels each portrait with the actor's description", () => {
    render(
      <ActorGrid
        actors={[
          { id: "a1", workspaceId: null, name: "Léa", gender: "female", ageRange: "25-34", style: "casual", voiceProfile: "warm", status: "active" },
        ]}
      />,
    );
    expect(screen.getByRole("img", { name: /Léa — casual, 25-34/ })).toBeDefined();
  });
});

describe("Script chat", () => {
  it("marks the tagged emotion pressed and reports retags", () => {
    const onEmotion = vi.fn();
    render(
      <ScriptLines
        lines={[{ index: 0, role: "hook", text: "Stop scrolling.", emotion: "excited" }]}
        onEmotion={onEmotion}
      />,
    );
    expect(screen.getByRole("button", { name: "excited", pressed: true })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "calm" }));
    expect(onEmotion).toHaveBeenCalledWith(0, "calm");
  });
});

describe("Generation monitor", () => {
  it("teaches the empty stage", () => {
    render(<GenerationTimeline generations={[]} />);
    expect(screen.getByText("No render yet — the stage is lit")).toBeDefined();
  });

  it("announces job rows in a live region", () => {
    const { container } = render(
      <GenerationTimeline
        generations={[
          { id: "g1", provider: "veo", modelId: "veo-3.1-fast", tier: "draft", status: "in_progress", durationS: 20, createdAt: new Date() },
        ]}
      />,
    );
    expect(container.querySelector("[aria-live='polite']")).not.toBeNull();
    expect(screen.getByText("in_progress")).toBeDefined();
  });
});

describe("Benchmark lab", () => {
  it("shows one column per provider and votes in gold", () => {
    const onVote = vi.fn();
    render(
      <BenchmarkCompare
        entries={[
          { id: "b1", modelKey: "seedance", status: "completed", latencyMs: 52000 },
          { id: "b2", modelKey: "veo", status: "completed", latencyMs: 41000 },
        ]}
        onVote={onVote}
      />,
    );
    expect(screen.getByText("seedance")).toBeDefined();
    expect(screen.getByText("veo")).toBeDefined();
    fireEvent.change(screen.getAllByRole("combobox", { name: "Quality score" })[0]!, { target: { value: "1" } });
    expect(onVote).toHaveBeenCalledWith("b1", 1);
  });
});

describe("Adopt the winning provider", () => {
  it("offers the gold adopt button on the winning column only and reports the provider", () => {
    const onAdopt = vi.fn();
    render(
      <BenchmarkCompare
        entries={[
          { id: "b1", modelKey: "veo", status: "completed", votes: { u1: 1 } },
          { id: "b2", modelKey: "kling", status: "completed", votes: { u1: 1, u2: 1 } },
        ]}
        winnerEntryId="b2"
        onAdopt={onAdopt}
      />,
    );
    const adopt = screen.getAllByRole("button", { name: "Adopt for project" });
    expect(adopt).toHaveLength(1);
    fireEvent.click(adopt[0]!);
    expect(onAdopt).toHaveBeenCalledWith("kling");
  });

  it("surfaces the capability warning next to the adopt decision", () => {
    render(
      <BenchmarkCompare
        entries={[{ id: "b1", modelKey: "kling", status: "completed", votes: { u1: 2 } }]}
        winnerEntryId="b1"
        onAdopt={() => undefined}
        adoptWarning="kling does not cover 1:1 — choose another format."
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("does not cover");
  });
});

describe("Reconcile timeout UX", () => {
  const base = { id: "g1", modelId: "m", tier: "draft" as const, durationS: 20, createdAt: "2026-07-12T10:00:00Z" };
  it("explains a RECONCILE_TIMEOUT failure and recovery", () => {
    render(
      <GenerationTimeline
        generations={[{ ...base, provider: "kling", status: "failed", errorCode: "RECONCILE_TIMEOUT" }]}
      />,
    );
    expect(screen.getByText("The model did not finish before its time limit. Check it before retrying.")).toBeDefined();
  });
  it("offers to relaunch a failed render and shows its readable reason", () => {
    const onRelaunch = vi.fn();
    render(
      <GenerationTimeline
        onRelaunch={onRelaunch}
        generations={[{ ...base, provider: "veo", status: "failed", errorCode: "PROVIDER_AUTH", errorDetail: "Google rejected the API key." }]}
      />,
    );
    expect(screen.getByText("Google rejected the API key.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Relaunch" }));
    expect(onRelaunch).toHaveBeenCalledWith("g1");
  });

  it("keeps ordinary failures generic", () => {
    render(
      <GenerationTimeline
        generations={[{ ...base, provider: "veo", status: "failed", errorCode: "PROVIDER_REFUSED" }]}
      />,
    );
    expect(screen.queryByText("The model did not finish before its time limit. Check it before retrying.")).toBeNull();
  });
});

describe("Creation wizard", () => {
  it("exposes the four load-bearing steps with the current one marked", () => {
    render(<WizardStepper current={1} />);
    const steps = screen.getByLabelText("Wizard steps");
    expect(steps.textContent).toContain("Platform");
    expect(steps.textContent).toContain("Format");
    expect(steps.textContent).toContain("Language");
    expect(steps.textContent).toContain("Actor");
    expect(screen.getByText("2. Format").getAttribute("aria-current")).toBe("step");
  });
});
