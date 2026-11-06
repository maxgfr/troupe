// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The pure views (data in via props, decisions out via callbacks) render
// without any tRPC. The client is stubbed only because the page files import
// it at module level.
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({}),
    identity: {
      myWorkspaces: { useQuery: () => ({ isPending: true }) },
      projects: { useQuery: () => ({ isPending: true }) },
    },
    actors: { list: { useQuery: () => ({ isPending: true }) } },
    studio: {
      formatOptions: { useQuery: () => ({ isPending: true }) },
      providersFor: { useQuery: () => ({ isPending: true }) },
      getProject: { useQuery: () => ({ isPending: true }) },
      createFromWizard: { useMutation: () => ({}) },
      updateChoices: { useMutation: () => ({}) },
    },
    script: {
      history: { useQuery: () => ({ isPending: true }) },
      paste: { useMutation: () => ({}) },
      setLineEmotion: { useMutation: () => ({}) },
    },
    generation: { forProject: { useQuery: () => ({ isPending: true }) }, launchText: { useMutation: () => ({}) } },
    benchmark: {
      start: { useMutation: () => ({}) },
      get: { useQuery: () => ({ isPending: true }) },
      vote: { useMutation: () => ({}) },
    },
    export: { checkSpecs: { useQuery: () => ({ isPending: true }) }, create: { useMutation: () => ({}) } },
  },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

import { DashboardView, PosterSkeletons } from "./(app)/dashboard/dashboard-view";
import { ActorGrid } from "./(app)/actors/actor-grid";
import { ScriptLines } from "./(app)/projects/[projectId]/script/script-lines";
import { GenerationTimeline } from "./(app)/projects/[projectId]/generation-timeline";
import { BenchmarkCompare } from "./(app)/benchmark/benchmark-compare";
import { WizardStepper } from "./(app)/projects/new/wizard-stepper";
import { Composer } from "./(app)/shots/composer";
import { Gallery } from "./(app)/shots/gallery";
import type { Shot, ShotModel } from "./(app)/shots/types";

afterEach(cleanup);

describe("Dashboard", () => {
  it("teaches the first action when there is no project", () => {
    render(<DashboardView projects={[]} />);
    expect(screen.getByText("Create your first project")).toBeDefined();
    expect(screen.getByRole("link", { name: "New project" })).toBeDefined();
  });

  it("lists projects with the stage each is at, in words, and the platform's own name", () => {
    render(
      <DashboardView
        projects={[
          { id: "p1", title: "Spring drop", platform: "tiktok", format: "9:16", status: "scripting" },
          { id: "p2", title: "Summer drop", platform: "youtube", format: "16:9", status: "review" },
          { id: "p3", title: "Autumn drop", platform: "linkedin", format: "1:1", status: "done" },
        ]}
      />,
    );
    expect(screen.getByText("Spring drop")).toBeDefined();
    expect(screen.getByText("Script")).toBeDefined();
    expect(screen.getByText("To review")).toBeDefined();
    expect(screen.getByText("Exported")).toBeDefined();
    expect(screen.getByText(/TikTok · 9:16/)).toBeDefined();
    expect(screen.getByText(/YouTube · 16:9/)).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says when no model can render yet, with or without projects", () => {
    const { rerender } = render(<DashboardView projects={[]} readiness={{ ready: false }} />);
    expect(screen.getByRole("status").textContent).toMatch(/No video model can render yet/);
    expect(screen.getByRole("link", { name: /Add an API key or a local model in Settings/ }).getAttribute("href")).toBe(
      "/settings",
    );
    expect(screen.getByText("Create your first project")).toBeDefined();
    rerender(
      <DashboardView
        projects={[{ id: "p1", title: "Spring drop", platform: "tiktok", format: "9:16", status: "scripting" }]}
        readiness={{ ready: false }}
      />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/No video model can render yet/);
  });
});

describe("Projects loading", () => {
  it("announces one loading status around a list of poster shapes", () => {
    render(<PosterSkeletons />);
    const status = screen.getByRole("status", { name: "Loading" });
    expect(status.tagName).toBe("DIV");
    expect(status.querySelector("ul")!.querySelectorAll("li")).toHaveLength(4);
  });
});

describe("Actor library", () => {
  it("labels each portrait with the actor's description", () => {
    render(
      <ActorGrid
        actors={[
          {
            id: "a1",
            workspaceId: null,
            name: "Léa",
            gender: "female",
            ageRange: "25-34",
            style: "casual",
            voiceProfile: "warm",
            status: "active",
          },
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

  it("fetches the newest video once (its row shows a play mark), and a still for the others", () => {
    const { container } = render(
      <GenerationTimeline
        projectId="p1"
        generations={[
          {
            id: "g2",
            provider: "local",
            modelId: "r",
            tier: "draft",
            status: "completed",
            durationS: 8,
            createdAt: new Date(),
            outputAssetUrl: "/api/media/new",
          },
          {
            id: "g1",
            provider: "local",
            modelId: "r",
            tier: "draft",
            status: "completed",
            durationS: 8,
            createdAt: new Date(),
            outputAssetUrl: "/api/media/old",
          },
        ]}
      />,
    );
    const sources = [...container.querySelectorAll("video")].map((v) => v.getAttribute("src"));
    expect(sources).toEqual(["/api/media/new", "/api/media/old#t=0.6"]);
  });

  it("keeps a render's length and cost whole on phones", () => {
    render(
      <GenerationTimeline
        generations={[
          {
            id: "g1",
            provider: "veo",
            modelId: "veo-3.1-fast",
            modelLabel: "Veo 3.1 Fast",
            tier: "final",
            status: "completed",
            durationS: 8,
            costUsd: 1.2,
            costSource: "estimate",
            createdAt: new Date(),
          },
        ]}
      />,
    );
    const meta = screen.getByText(/Veo 3.1 Fast · 8 s/);
    expect(meta.className).toContain("font-mono");
    expect(meta.className).not.toMatch(/(^| )truncate( |$)/);
    expect(meta.className).toContain("sm:truncate");
  });

  it("announces job rows in a live region", () => {
    const { container } = render(
      <GenerationTimeline
        generations={[
          {
            id: "g1",
            provider: "veo",
            modelId: "veo-3.1-fast",
            tier: "draft",
            status: "in_progress",
            durationS: 20,
            createdAt: new Date(),
          },
        ]}
      />,
    );
    expect(container.querySelector("[aria-live='polite']")).not.toBeNull();
    expect(screen.getByText("rendering")).toBeDefined();
  });
});

describe("Compare", () => {
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
        generations={[
          {
            ...base,
            provider: "veo",
            status: "failed",
            errorCode: "PROVIDER_AUTH",
            errorDetail: "Google rejected the API key.",
          },
        ]}
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
    expect(steps.querySelector('[aria-current="step"]')!.textContent).toBe("2 Format");
  });
});

const SHOT_MODEL: ShotModel = {
  key: "kling-3.0",
  label: "Kling 3.0",
  vendor: "fal.ai",
  kind: "cloud",
  capabilities: {
    aspectRatios: ["9:16", "16:9"],
    resolutions: ["720p"],
    durationsS: [5, 10],
    audio: "optional",
    dialogueLanguages: null,
  },
  defaults: { resolution: "720p", durationS: 5, audio: true },
  pricePerSecondUsd: 0.1,
  available: true,
  unavailableReason: null,
  compatible: true,
  warnings: [],
  credential: "fal",
  status: "ready",
  promptMaxChars: 4000,
  needsScript: false,
};

const composerProps = (over: Partial<React.ComponentProps<typeof Composer>> = {}) => ({
  text: "",
  onText: vi.fn(),
  models: [SHOT_MODEL],
  chosen: [SHOT_MODEL],
  onToggleModel: vi.fn(),
  capabilities: SHOT_MODEL.capabilities,
  missing: null,
  soundPerModel: false,
  settings: { aspectRatio: "9:16", durationS: 5, resolution: "720p", audio: true },
  onSettings: vi.fn(),
  actors: [{ id: "a1", name: "Amara" }],
  actorId: null,
  onActor: vi.fn(),
  count: 2,
  onCount: vi.fn(),
  launching: false,
  error: null,
  onLaunch: vi.fn(),
  focusNonce: 0,
  ...over,
});

describe("Shots composer", () => {
  it("draws the chosen model's choices and an estimate for every render asked for", () => {
    const props = composerProps({ text: "A dolly toward a cup of coffee." });
    render(<Composer {...props} />);
    expect(screen.getByRole("button", { name: "9:16" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("$1.00 est.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "16:9" }));
    expect(props.onSettings).toHaveBeenCalledWith({ aspectRatio: "16:9" });
    fireEvent.keyDown(screen.getByLabelText("Describe the shot"), { key: "Enter", metaKey: true });
    expect(props.onLaunch).toHaveBeenCalledOnce();
  });

  it("does not launch an empty shot", () => {
    const props = composerProps();
    render(<Composer {...props} />);
    expect((screen.getByRole("button", { name: /Launch 2/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByLabelText("Describe the shot"), { key: "Enter", ctrlKey: true });
    expect(props.onLaunch).not.toHaveBeenCalled();
  });

  it("finds a model by name and says which one needs its key", () => {
    const onToggleModel = vi.fn();
    const veo = {
      ...SHOT_MODEL,
      key: "veo",
      label: "Veo 3.1 Fast",
      vendor: "Google",
      available: false,
      status: "missing-credentials" as const,
    };
    render(<Composer {...composerProps({ models: [SHOT_MODEL, veo], onToggleModel })} />);
    fireEvent.click(screen.getByRole("button", { name: /Change the models/ }));
    fireEvent.change(screen.getByLabelText("Search the models"), { target: { value: "veo" } });
    expect(within(screen.getByRole("list", { name: "Models" })).queryByText("Kling 3.0")).toBeNull();
    expect(screen.getByText("Needs its API key")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Veo 3.1 Fast/ }));
    expect(onToggleModel).toHaveBeenCalledWith(veo);
  });

  it("renders on every ticked model, counts every render and adds up their estimates", () => {
    const veo = { ...SHOT_MODEL, key: "veo", label: "Veo 3.1 Fast", vendor: "Google", pricePerSecondUsd: 0.15 };
    const onToggleModel = vi.fn();
    render(
      <Composer
        {...composerProps({ text: "Dawn.", models: [SHOT_MODEL, veo], chosen: [SHOT_MODEL, veo], onToggleModel })}
      />,
    );
    expect(screen.getByRole("button", { name: /Change the models/ }).textContent).toContain("Kling 3.0 + 1");
    // 2 models × 2 renders × 5 s × ($0.10 + $0.15).
    expect(screen.getByText("$2.50 est.")).toBeDefined();
    expect(screen.getByRole("button", { name: /Launch 4/ })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Change the models/ }));
    const veoItem = within(screen.getByRole("list", { name: "Models" })).getByRole("button", { name: /Veo 3.1 Fast/ });
    expect(veoItem.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(veoItem);
    expect(onToggleModel).toHaveBeenCalledWith(veo);
  });

  it("says what the ticked models do not share, and does not launch", () => {
    const props = composerProps({
      text: "Dawn.",
      missing: "Kling 3.0 and Square share no format. Choose other models.",
    });
    render(<Composer {...props} />);
    expect(screen.getByText(/share no format/)).toBeDefined();
    expect((screen.getByRole("button", { name: /Launch/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

const SHOT: Shot = {
  id: "s1",
  modelKey: "kling-3.0",
  modelLabel: "Kling 3.0",
  prompt: "A dolly toward a cup of coffee.",
  aspectRatio: "9:16",
  durationS: 5,
  resolution: "720p",
  actorId: null,
  status: "failed",
  progress: null,
  costUsd: null,
  costSource: null,
  errorCode: "X",
  errorDetail: "The model refused the shot.",
  favorite: false,
  relaunched: false,
  width: null,
  height: null,
  videoDurationS: null,
  createdAt: new Date(),
  completedAt: null,
  videoUrl: null,
  downloadUrl: null,
};

describe("Shots gallery", () => {
  it("explains a failed shot and offers to relaunch, reuse or delete it", () => {
    const handlers = { onOpen: vi.fn(), onReuse: vi.fn(), onFavorite: vi.fn(), onDelete: vi.fn(), onRelaunch: vi.fn() };
    render(<Gallery shots={[SHOT]} relaunching={null} {...handlers} />);
    expect(screen.getByText("The model refused the shot.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Relaunch" }));
    fireEvent.click(screen.getByRole("button", { name: "Reuse this shot" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete this shot" }));
    expect(handlers.onRelaunch).toHaveBeenCalledWith(SHOT);
    expect(handlers.onReuse).toHaveBeenCalledWith(SHOT);
    expect(handlers.onDelete).toHaveBeenCalledWith(SHOT);
  });

  it("shows a rendering shot's progress and keeps it from being deleted", () => {
    render(
      <Gallery
        shots={[{ ...SHOT, status: "in_progress", progress: 0.4, errorDetail: null }]}
        relaunching={null}
        onOpen={vi.fn()}
        onReuse={vi.fn()}
        onFavorite={vi.fn()}
        onDelete={vi.fn()}
        onRelaunch={vi.fn()}
      />,
    );
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("40");
    expect(screen.queryByRole("button", { name: "Delete this shot" })).toBeNull();
  });
});
