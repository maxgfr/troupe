// @vitest-environment jsdom
// Behavioral coverage for the decision flows: wizard multi-step state and
// export disclosure + gate.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const createProjectAsync = vi.fn(async () => ({ id: "p1" }));
const createExportMutate = vi.fn();

const COMPLETED_GEN = {
  id: "g1",
  tier: "final",
  provider: "veo",
  durationS: 8,
  status: "completed",
  createdAt: new Date("2026-07-12T10:00:00Z").toISOString(),
};

vi.mock("~/app/_components/workspace-context", () => ({
  useWorkspace: () => ({ status: "ready", workspaceId: "ws1" }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push }),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ generation: { forProject: { invalidate: vi.fn() } } }),
    studio: {
      formatOptions: {
        useQuery: () => ({ isPending: false, data: [{ format: "9:16", preselected: true }, { format: "1:1" }] }),
      },
      modelOptions: {
        useQuery: () => ({
          isPending: false,
          data: {
            models: [["veo-3.1-fast", "Veo 3.1 Fast"], ["kling-3.0", "Kling 3.0"]].map(([key, label]) => ({
              key, label, vendor: "v", kind: "cloud",
              capabilities: { aspectRatios: ["9:16"], resolutions: ["720p"], durationsS: [8], audio: "always", dialogueLanguages: ["en"] },
              defaults: { resolution: "720p", durationS: 8, audio: true },
              pricePerSecondUsd: null, available: true, unavailableReason: null, compatible: true, warnings: [],
            })),
            defaultModelKey: "veo-3.1-fast",
          },
        }),
      },
      createFromWizard: { useMutation: () => ({ mutateAsync: createProjectAsync, isPending: false }) },
    },
    actors: {
      list: {
        useQuery: () => ({
          isPending: false,
          data: [
            { id: "a1", name: "Léa", style: "casual", ageRange: "25-34", status: "active" },
            { id: "a2", name: "Max", style: "expert", ageRange: "35-44", status: "unavailable" },
          ],
        }),
      },
    },
    generation: { forProject: { useQuery: () => ({ isPending: false, data: [COMPLETED_GEN] }) } },
    export: {
      checkSpecs: { useQuery: () => ({ isPending: false, data: { ok: true } }) },
      create: { useMutation: () => ({ mutate: createExportMutate, isPending: false }) },
    },
  },
}));

import NewProjectPage from "./(app)/projects/new/page";
import ExportPage from "./(app)/projects/[projectId]/export/page";

// React's use() reads an already-fulfilled thenable synchronously when the
// status/value fields are present — no Suspense boundary needed in jsdom.
const params = Object.assign(Promise.resolve({ projectId: "p1" }), {
  status: "fulfilled",
  value: { projectId: "p1" },
}) as Promise<{ projectId: string }>;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("wizard multi-step behavior", () => {
  it("walks the four steps, persists the model pick, and gates creation on title+actor", async () => {
    render(<NewProjectPage />);
    // step 0 — platform; Back disabled at the start
    expect((screen.getByRole("button", { name: "Back" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    // step 1 — format preselected + model picker
    expect(screen.getByRole("radio", { name: /Kling 3\.0/ })).toBeDefined();
    expect(screen.queryByText(/\bcr$/)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Kling 3\.0/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    // step 2 — language
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    // step 3 — creation stays locked without title+actor
    const create = screen.getByRole("button", { name: /Create project/ }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/Spring drop/), { target: { value: "My ad" } });
    fireEvent.click(screen.getByRole("radio", { name: /Léa/ }));
    expect(create.disabled).toBe(false);
    fireEvent.click(create);
    await vi.waitFor(() => expect(push).toHaveBeenCalled());
    expect(createProjectAsync).toHaveBeenCalledWith(expect.objectContaining({ title: "My ad", actorId: "a1", modelKey: "kling-3.0", format: "9:16" }));
    expect(push).toHaveBeenCalledWith("/projects/p1/script");
  });

  it("an unavailable actor cannot be picked", () => {
    render(<NewProjectPage />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect((screen.getByRole("radio", { name: /Max/ }) as HTMLInputElement).disabled).toBe(true);
  });
});

describe("export flow", () => {
  it("shows the platform-specific disclosure and swaps it with the preset", () => {
    render(<ExportPage params={params} />);
    expect(screen.getByTestId("disclosure-matrix").textContent).toMatch(/TikTok.*toggle/is);
    fireEvent.click(screen.getByRole("radio", { name: /linkedin/i }));
    expect(screen.getByTestId("disclosure-matrix").textContent).toMatch(/caption/i);
  });

  it("export stays locked until quality is confirmed, then ships the payload", () => {
    render(<ExportPage params={params} />);
    const submit = screen.getByRole("button", { name: "Create export" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(createExportMutate).toHaveBeenCalledWith(
      expect.objectContaining({ generationId: "g1", platform: "tiktok", qualityConfirmed: true }),
    );
  });
});
