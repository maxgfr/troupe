// @vitest-environment jsdom
// Behavioral coverage for « Adopt the winning model » — votes pick a winner,
// adopting writes project.modelKey and returns to the project page.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ModelOptionView } from "./(app)/projects/model-choice";

const push = vi.fn();
const searchParams = "";
const updateChoicesMutate = vi.fn();
const modelOptionsInput = vi.fn();

let projectModels: ModelOptionView[] = [];
let scriptSeconds = 12;

const option = (key: string, patch: Partial<ModelOptionView> = {}): ModelOptionView => ({
  key, label: key, vendor: "v", kind: "cloud",
  capabilities: { aspectRatios: ["1:1"], resolutions: ["720p"], durationsS: [5, 10, 15], audio: "optional", dialogueLanguages: null },
  defaults: { resolution: "720p", durationS: 10, audio: true },
  pricePerSecondUsd: null, available: true, unavailableReason: null, compatible: true, warnings: [], ...patch,
});

vi.mock("~/app/_components/workspace-context", () => ({
  useWorkspace: () => ({ status: "ready", workspaceId: "ws1" }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/benchmark",
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(searchParams),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({}),
    benchmark: {
      list: { useQuery: () => ({ isPending: false, error: null, data: [{ id: "11111111-1111-4111-8111-111111111111", brief: "Adopt brief", createdAt: "2026-07-12T10:00:00Z", entryCount: 2, winnerLabel: null }] }) },
      get: {
        useQuery: () => ({
          isPending: false,
          error: null,
          data: {
            id: "11111111-1111-4111-8111-111111111111",
            projectId: "p1",
            brief: "Spring drop",
            entries: [
              { id: "b1", modelKey: "veo", label: "Veo", status: "completed", votes: { u1: 1 } },
              { id: "b2", modelKey: "kling", label: "Kling", status: "completed", votes: { u1: 1, u2: 1 } },
            ],
            meanByModel: { veo: 1, kling: 1 },
          },
          refetch: vi.fn(),
        }),
      },
      vote: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    studio: {
      getProject: {
        useQuery: () => ({ isPending: false, data: { id: "p1", format: "1:1", platform: "instagram", language: "en" } }),
      },
      modelOptions: {
        useQuery: (input: unknown) => {
          modelOptionsInput(input);
          return { isPending: false, data: { models: projectModels, defaultModelKey: null } };
        },
      },
      updateChoices: {
        useMutation: (opts?: { onSuccess?: () => void }) => ({
          mutate: (input: unknown) => {
            updateChoicesMutate(input);
            opts?.onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
    script: {
      history: {
        useQuery: () => ({
          isPending: false,
          error: null,
          data: [{ id: "s0", estimatedDurationS: 4 }, { id: "s1", estimatedDurationS: scriptSeconds }],
        }),
      },
    },
  },
}));

import BenchmarkPage from "./(app)/benchmark/page";

function openRun() {
  fireEvent.click(screen.getByRole("button", { name: /Adopt brief/ }));
}

const warnings = () => screen.queryAllByRole("status").map((el) => el.textContent ?? "").join(" ");

afterEach(cleanup);
beforeEach(() => {
  push.mockClear();
  updateChoicesMutate.mockClear();
  modelOptionsInput.mockClear();
  scriptSeconds = 12;
});

describe("adopt capability check", () => {
  it("checks the winner against the project's real format and language", () => {
    projectModels = [option("kling")];
    render(<BenchmarkPage />);
    openRun();
    expect(modelOptionsInput).toHaveBeenCalledWith({ format: "1:1", language: "en" });
  });

  it("warns when the winner cannot fit the latest script", () => {
    projectModels = [option("kling")];
    scriptSeconds = 34;
    render(<BenchmarkPage />);
    openRun();
    expect(warnings()).toContain("cannot fit the current 34s script");
  });
});

describe("adopt flow", () => {
  it("adopting the vote winner writes project.modelKey and returns to the project", () => {
    projectModels = [option("veo"), option("kling")];
    render(<BenchmarkPage />);
    openRun();
    fireEvent.click(screen.getByRole("button", { name: "Adopt for project" }));
    expect(updateChoicesMutate).toHaveBeenCalledWith({ projectId: "p1", modelKey: "kling" });
    expect(push).toHaveBeenCalledWith("/projects/p1");
  });

  it("warns before adopting when the winner does not render the project's format", () => {
    projectModels = [option("veo"), option("kling", { compatible: false })];
    render(<BenchmarkPage />);
    openRun();
    expect(warnings()).toContain("does not render 1:1");
    expect((screen.getByRole("button", { name: "Adopt for project" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
