// @vitest-environment jsdom
// The project page: the chosen model stays visible, and the launch panel only
// offers what the chosen model can do.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModelOptionView } from "./(app)/projects/model-choice";

let project: Record<string, unknown> = {};
let history: Record<string, unknown>[] = [];
let models: ModelOptionView[] = [];
const selectModel = vi.fn();
const launch = vi.fn();

const option = (key: string, caps: Partial<ModelOptionView["capabilities"]> = {}, patch: Partial<ModelOptionView> = {}): ModelOptionView => ({
  key, label: key.toUpperCase(), vendor: "v", kind: "cloud",
  capabilities: { aspectRatios: ["9:16"], resolutions: ["720p"], durationsS: [4, 6, 8], audio: "always", dialogueLanguages: null, ...caps },
  defaults: { resolution: "720p", durationS: 8, audio: true },
  pricePerSecondUsd: null, available: true, unavailableReason: null, compatible: true, warnings: [], ...patch,
});

vi.mock("~/app/_components/workspace-context", () => ({
  useWorkspace: () => ({ status: "ready", workspaceId: "ws1" }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/projects/p1",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ generation: { forProject: { invalidate: vi.fn() } } }),
    studio: {
      updateChoices: { useMutation: () => ({ mutate: selectModel, isPending: false }) },
      getProject: { useQuery: () => ({ isPending: false, error: null, data: project }) },
      modelOptions: { useQuery: () => ({ isPending: false, data: { models, defaultModelKey: "veo" } }) },
      deleteProject: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    benchmark: { start: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
    generation: {
      forProject: { useQuery: () => ({ isPending: false, error: null, data: [] }) },
      launchText: { useMutation: () => ({ mutate: launch, isPending: false }) },
      relaunch: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    script: { history: { useQuery: () => ({ isPending: false, data: history }) } },
    chat: {
      history: { useQuery: () => ({ isPending: false, error: null, data: { messages: [], provider: { id: "ollama", label: "Ollama", modelId: "qwen3:4b", problem: null, wordsPerSecond: 2.5 } } }) },
      send: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      applyProposal: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      applyAndLaunch: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    actors: { list: { useQuery: () => ({ data: [] }) } },
  },
}));

import MonitorPage from "./(app)/projects/[projectId]/page";

function fulfilledParams(projectId: string) {
  return Object.assign(Promise.resolve({ projectId }), {
    status: "fulfilled" as const,
    value: { projectId },
  });
}

function renderPage() {
  render(
    <Suspense fallback={null}>
      <MonitorPage params={fulfilledParams("p1")} />
    </Suspense>,
  );
}

const baseProject = { id: "p1", title: "Ad", platform: "tiktok", format: "9:16", language: "en" };

afterEach(() => { cleanup(); history = []; vi.clearAllMocks(); });

describe("chosen model chip", () => {
  it("shows the project's chosen model in the header", () => {
    models = [option("veo"), option("kling")];
    project = { ...baseProject, modelKey: "kling" };
    renderPage();
    expect(screen.getByTestId("project-model").textContent).toMatch(/KLING · chosen/);
  });

  it("shows no chip while the project follows the studio default", () => {
    models = [option("veo")];
    project = { ...baseProject, modelKey: null };
    renderPage();
    expect(screen.queryByTestId("project-model")).toBeNull();
  });
});

describe("launch panel", () => {
  it("never replaces an unavailable chosen model silently", () => {
    models = [option("veo"), option("kling", {}, { available: false, unavailableReason: "Add a fal.ai key in Settings." })];
    project = { ...baseProject, modelKey: "kling" };
    history = [{ id: "s1", estimatedDurationS: 4 }];
    renderPage();
    expect(screen.getAllByRole("status").map((s) => s.textContent).join(" ")).toMatch(/unavailable: Add a fal.ai key/);
    fireEvent.change(screen.getByLabelText("Video model"), { target: { value: "veo" } });
    expect(selectModel).toHaveBeenCalledWith({ projectId: "p1", modelKey: "veo" });
  });

  it("offers only the chosen model's lengths and resolutions, and the audio switch when optional", () => {
    models = [option("seedance", { resolutions: ["480p", "720p", "1080p"], durationsS: [4, 6, 8, 10, 12], audio: "optional" })];
    project = { ...baseProject, modelKey: null };
    history = [{ id: "s1", estimatedDurationS: 7 }];
    renderPage();
    const lengths = [...(screen.getByLabelText("Clip length") as HTMLSelectElement).options].map((o) => o.value);
    expect(lengths).toEqual(["8", "10", "12"]);
    fireEvent.change(screen.getByLabelText("Resolution"), { target: { value: "1080p" } });
    fireEvent.click(screen.getByLabelText("Generate audio"));
    fireEvent.click(screen.getByRole("button", { name: "Launch draft" }));
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ modelKey: "seedance", durationS: 8, resolution: "1080p", audio: false, scriptId: "s1" }));
  });

  it("explains when the script is longer than the model's longest clip", () => {
    models = [option("veo")];
    project = { ...baseProject, modelKey: null };
    history = [{ id: "s1", estimatedDurationS: 12 }];
    renderPage();
    expect(screen.getAllByRole("status").map((s) => s.textContent).join(" ")).toMatch(/at most 8s/);
    expect((screen.getByRole("button", { name: "Launch draft" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByLabelText("Generate audio")).toBeNull();
  });
});
