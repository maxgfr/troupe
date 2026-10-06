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
  tier: "draft",
  provider: "veo",
  modelId: "veo-3.1",
  modelLabel: "Veo 3.1 Fast",
  durationS: 8,
  mediaDurationS: 8.25,
  status: "completed",
  outputAssetUrl: "/api/media/a1",
  createdAt: new Date("2026-07-12T10:00:00Z").toISOString(),
};
const OLDER_GEN = {
  ...COMPLETED_GEN,
  id: "g0",
  modelLabel: "Kling 3.0",
  mediaDurationS: null,
  createdAt: new Date("2026-07-11T10:00:00Z").toISOString(),
};

let searchParams = "";
let exportState: { isSuccess: boolean } = { isSuccess: false };

vi.mock("~/app/_components/workspace-context", () => ({
  useWorkspace: () => ({ status: "ready", workspaceId: "ws1" }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(searchParams),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ generation: { forProject: { invalidate: vi.fn() } } }),
    studio: {
      getProject: {
        useQuery: () => ({
          isPending: false,
          data: { id: "p1", title: "Spring drop", platform: "youtube", format: "9:16", language: "en" },
        }),
      },
      formatOptions: {
        useQuery: () => ({ isPending: false, data: [{ format: "9:16", preselected: true }, { format: "1:1" }] }),
      },
      modelOptions: {
        useQuery: () => ({
          isPending: false,
          data: {
            models: [
              ["veo-3.1-fast", "Veo 3.1 Fast"],
              ["kling-3.0", "Kling 3.0"],
            ].map(([key, label]) => ({
              key,
              label,
              vendor: "v",
              kind: "cloud",
              capabilities: {
                aspectRatios: ["9:16"],
                resolutions: ["720p"],
                durationsS: [8],
                audio: "always",
                dialogueLanguages: ["en"],
              },
              defaults: { resolution: "720p", durationS: 8, audio: true },
              pricePerSecondUsd: null,
              available: true,
              unavailableReason: null,
              compatible: true,
              warnings: [],
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
    generation: { forProject: { useQuery: () => ({ isPending: false, data: [COMPLETED_GEN, OLDER_GEN] }) } },
    export: {
      checkSpecs: { useQuery: () => ({ isPending: false, data: { ok: true } }) },
      create: { useMutation: () => ({ mutate: createExportMutate, isPending: false, reset: vi.fn(), ...exportState }) },
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
  searchParams = "";
  exportState = { isSuccess: false };
});

describe("wizard multi-step behavior", () => {
  it("walks the four steps, persists the model pick, and gates creation on title+actor", async () => {
    render(<NewProjectPage />);
    // step 0 — platform; Back disabled at the start
    expect((screen.getByRole("button", { name: "Back" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("radio", { name: "TikTok" })).toBeDefined();
    // The title is asked for on the first step, not discovered missing on the last.
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText(/Name the project first/)).toBeDefined();
    expect(screen.getByRole("radio", { name: "TikTok" })).toBeDefined();
    fireEvent.change(screen.getByPlaceholderText(/Spring drop/), { target: { value: "My ad" } });
    expect(screen.queryByText(/Name the project first/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    // step 1 — format preselected + model picker
    expect(screen.getByRole("radio", { name: /Kling 3\.0/ })).toBeDefined();
    expect(screen.queryByText(/\bcr$/)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Kling 3\.0/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    // step 2 — language
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    // step 3 — creation stays locked without an actor
    const create = screen.getByRole("button", { name: /Create project/ }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /Léa/ }));
    expect(create.disabled).toBe(false);
    fireEvent.click(create);
    await vi.waitFor(() => expect(push).toHaveBeenCalled());
    expect(createProjectAsync).toHaveBeenCalledWith(
      expect.objectContaining({ title: "My ad", actorId: "a1", modelKey: "kling-3.0", format: "9:16" }),
    );
    expect(push).toHaveBeenCalledWith("/projects/p1/script");
  });

  it("an unavailable actor cannot be picked", () => {
    render(<NewProjectPage />);
    fireEvent.change(screen.getByPlaceholderText(/Spring drop/), { target: { value: "My ad" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect((screen.getByRole("radio", { name: /Max/ }) as HTMLInputElement).disabled).toBe(true);
  });
});

describe("export flow", () => {
  it("starts on the project's platform and swaps the disclosure with the preset", () => {
    render(<ExportPage params={params} />);
    expect((screen.getByRole("radio", { name: "YouTube" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId("disclosure-matrix").textContent).toMatch(/YouTube/);
    fireEvent.click(screen.getByRole("radio", { name: "TikTok" }));
    expect(screen.getByTestId("disclosure-matrix").textContent).toMatch(/TikTok.*toggle/is);
    fireEvent.click(screen.getByRole("radio", { name: "LinkedIn" }));
    expect(screen.getByTestId("disclosure-matrix").textContent).toMatch(/caption/i);
  });

  it("names each render by its model and real length", () => {
    render(<ExportPage params={params} />);
    expect(screen.getByRole("radio", { name: /Veo 3\.1 Fast ?· 8\.3 s · draft/ })).toBeDefined();
    expect(screen.getByRole("radio", { name: /Kling 3\.0 ?· 8 s · draft/ })).toBeDefined();
  });

  it("export stays locked until quality is confirmed, then ships the payload", () => {
    render(<ExportPage params={params} />);
    const submit = screen.getByRole("button", { name: "Create export" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(createExportMutate).toHaveBeenCalledWith(
      expect.objectContaining({ generationId: "g1", platform: "youtube", qualityConfirmed: true }),
    );
  });

  it("preselects the render the project page linked to", () => {
    searchParams = "render=g0";
    render(<ExportPage params={params} />);
    expect((screen.getByRole("radio", { name: /Kling 3\.0/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("after the export, the download takes the button's place, named like the timeline's", () => {
    exportState = { isSuccess: true };
    render(<ExportPage params={params} />);
    expect(screen.queryByRole("button", { name: "Create export" })).toBeNull();
    const download = screen.getByRole("link", { name: "Download MP4" });
    expect(download.getAttribute("href")).toMatch(
      /^\/api\/media\/a1\?download=spring-drop-veo-3-1-fast-2026-07-12-\d{4}\.mp4$/,
    );
  });
});
