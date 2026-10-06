// @vitest-environment jsdom
// The Benchmark Lab lists the workspace runs — clicking one opens
// it, no UUID pasting. A vote tie shows an explicit tie state and
// never offers "Adopt for project".
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
let searchParams = "";
const getQueryInput = vi.fn();
const listFetch = vi.fn();

let runEntries: Array<{ id: string; modelKey: string; status: string; votes: Record<string, number> }> = [];
let listedRuns: Array<{
  id: string;
  brief: string;
  createdAt: string;
  entryCount: number;
  winnerLabel: string | null;
}> = [];

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
    useUtils: () => ({ benchmark: { list: { fetch: listFetch } } }),
    benchmark: {
      list: {
        useQuery: () => ({ isPending: false, error: null, data: listedRuns }),
      },
      get: {
        useQuery: (input: { runId: string }, opts?: { enabled?: boolean }) => {
          getQueryInput(input, opts);
          if (!opts?.enabled) return { isPending: false, error: null, data: undefined, refetch: vi.fn() };
          return {
            isPending: false,
            error: null,
            data: {
              id: input.runId,
              projectId: "p1",
              brief: "Spring drop",
              entries: runEntries,
              meanByModel: {},
            },
            refetch: vi.fn(),
          };
        },
      },
      vote: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    studio: {
      getProject: {
        useQuery: () => ({ isPending: false, data: { id: "p1", format: "9:16", platform: "tiktok" } }),
      },
      modelOptions: {
        useQuery: () => ({
          isPending: false,
          data: {
            models: ["veo", "kling"].map((key) => ({
              key,
              label: key,
              vendor: "v",
              kind: "cloud",
              capabilities: {
                aspectRatios: ["9:16"],
                resolutions: ["720p"],
                durationsS: [8],
                audio: "always",
                dialogueLanguages: null,
              },
              defaults: { resolution: "720p", durationS: 8, audio: true },
              pricePerSecondUsd: null,
              available: true,
              unavailableReason: null,
              compatible: true,
              warnings: [],
            })),
            defaultModelKey: null,
          },
        }),
      },
      updateChoices: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    script: {
      history: {
        useQuery: () => ({ isPending: false, error: null, data: [{ id: "s1", estimatedDurationS: 20 }] }),
      },
    },
  },
}));

import { BENCHMARK_LIST_LIMIT } from "~/modules/benchmark/list-limit";

import BenchmarkPage from "./(app)/benchmark/page";

afterEach(cleanup);
beforeEach(() => {
  push.mockClear();
  getQueryInput.mockClear();
  listFetch.mockClear();
  runEntries = [];
  listedRuns = [];
});

function summaryRun(i: number) {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    brief: `Run number ${i}`,
    createdAt: new Date(Date.UTC(2026, 6, 12, 10, 0, BENCHMARK_LIST_LIMIT - i)).toISOString(),
    entryCount: 2,
    winnerLabel: null,
  };
}

// The list is paged — a full first page offers
// « Show older comparisons », which appends the next page via the createdAt cursor.
describe("paged run list", () => {
  it("a full page offers Show older comparisons and appends the older page on click", async () => {
    listedRuns = Array.from({ length: BENCHMARK_LIST_LIMIT }, (_, i) => summaryRun(i));
    const older = { ...summaryRun(BENCHMARK_LIST_LIMIT), brief: "Older run" };
    listFetch.mockResolvedValue([older]);

    render(<BenchmarkPage />);
    fireEvent.click(screen.getByRole("button", { name: "Show older comparisons" }));

    expect(listFetch).toHaveBeenCalledWith({
      workspaceId: "ws1",
      before: new Date(listedRuns[listedRuns.length - 1]!.createdAt),
    });
    expect(await screen.findByText("Older run")).toBeTruthy();
  });

  it("a short page offers no pagination control", () => {
    listedRuns = [summaryRun(0)];
    render(<BenchmarkPage />);
    expect(screen.queryByRole("button", { name: "Show older comparisons" })).toBeNull();
  });
});

describe("workspace run list", () => {
  it("lists the workspace runs with brief, entry count and winner — clicking opens the run", () => {
    listedRuns = [
      {
        id: "22222222-2222-4222-8222-222222222222",
        brief: "Spring drop",
        createdAt: "2026-07-12T10:00:00Z",
        entryCount: 2,
        winnerLabel: "kling",
      },
    ];
    runEntries = [
      { id: "b1", modelKey: "veo", status: "completed", votes: {} },
      { id: "b2", modelKey: "kling", status: "completed", votes: { u1: 1 } },
    ];
    render(<BenchmarkPage />);
    const item = screen.getByRole("button", { name: /Spring drop/ });
    expect(item.textContent).toContain("kling");
    fireEvent.click(item);
    const opened = getQueryInput.mock.calls.some(
      ([input, opts]) => input.runId === "22222222-2222-4222-8222-222222222222" && opts?.enabled,
    );
    expect(opened).toBe(true);
    expect(screen.getAllByRole("combobox", { name: "Quality score" }).length).toBe(2);
  });

  it("opens the run named in ?run= right away (the project page's Compare links here)", () => {
    searchParams = "run=44444444-4444-4444-8444-444444444444";
    runEntries = [{ id: "b1", modelKey: "veo", status: "in_progress", votes: {} }];
    try {
      render(<BenchmarkPage />);
      expect(
        getQueryInput.mock.calls.some(
          ([input, opts]) => input.runId === "44444444-4444-4444-8444-444444444444" && opts?.enabled,
        ),
      ).toBe(true);
      expect(screen.queryByText("Open a comparison")).toBeNull();
      expect(screen.queryByText("No comparison yet")).toBeNull();
    } finally {
      searchParams = "";
    }
  });

  it("teaches when the workspace has no run yet", () => {
    render(<BenchmarkPage />);
    expect(screen.getByText("No comparison yet")).toBeDefined();
    expect(screen.getByText(/renders its script on each model that can/)).toBeDefined();
  });
});

describe("vote tie", () => {
  it("a tie shows an explicit tie notice and never offers adopt", () => {
    listedRuns = [
      {
        id: "33333333-3333-4333-8333-333333333333",
        brief: "Tie brief",
        createdAt: "2026-07-12T10:00:00Z",
        entryCount: 2,
        winnerLabel: null,
      },
    ];
    runEntries = [
      { id: "b1", modelKey: "veo", status: "completed", votes: { u1: 1 } },
      { id: "b2", modelKey: "kling", status: "completed", votes: { u2: 1 } },
    ];
    render(<BenchmarkPage />);
    fireEvent.click(screen.getByRole("button", { name: /Tie brief/ }));
    const statuses = screen.getAllByRole("status").map((el) => el.textContent ?? "");
    expect(statuses.join(" ")).toMatch(/tie — add a deciding vote/i);
    expect(screen.queryByRole("button", { name: "Adopt for project" })).toBeNull();
  });
});
