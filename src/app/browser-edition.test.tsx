// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditionProvider, type Edition, type LocalData } from "./_components/edition";
import { formatBytes, LocalDataSettings } from "./_components/local-data";
import { GenerationTimeline, type GenerationRow } from "./(app)/projects/[projectId]/generation-timeline";
import { LaunchPanel } from "./(app)/projects/[projectId]/launch-panel";
import type { ModelOptionView } from "./(app)/projects/model-choice";

// The browser edition renders with its own model, in the page: the project
// page shows that model's live progress and what a render there takes. Its
// data lives in the browser: Settings shows the storage, backs it up and
// deletes it.

afterEach(cleanup);

function localData(patch: Partial<LocalData> = {}): LocalData {
  return {
    deleteAll: vi.fn(async () => {}),
    exportBackup: vi.fn(async () => ({ blob: new Blob(["x"]), filename: "troupe-backup-2026-10-05-0945.tar" })),
    readBackup: vi.fn(async () => ({ summary: { createdAt: new Date(2026, 9, 5, 9, 45), projects: 3, videos: 1, bytes: 4_200_000 }, restore: vi.fn(async () => {}) })),
    storage: { estimate: async () => ({ usageBytes: 48_200_000, quotaBytes: 120e9 }), persisted: async () => false, persist: async () => true },
    ...patch,
  };
}

const browser: Edition = {
  kind: "browser",
  data: localData(),
  rendering: {
    modelKey: "browser",
    LaunchNote: () => <p>Note about rendering here</p>,
    Progress: ({ providerJobId }) => <p>Progress of {providerJobId}</p>,
  },
};

function inBrowser(node: React.ReactNode) {
  return render(<EditionProvider value={browser}>{node}</EditionProvider>);
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

describe("rendering in the browser edition", () => {
  it("shows the live progress of a render running in this browser", () => {
    inBrowser(<GenerationTimeline generations={[row({})]} />);
    expect(screen.getByText("Progress of job-1")).toBeDefined();
  });

  it("keeps the generic bar for other models and for jobs not yet accepted", () => {
    const { container } = inBrowser(
      <GenerationTimeline generations={[row({ id: "g2", modelKey: "veo-3.1-fast" }), row({ id: "g3", providerJobId: null })]} />,
    );
    expect(screen.queryByText(/Progress of/)).toBeNull();
    expect(container.querySelectorAll(".progress-glow")).toHaveLength(2);
  });

  it("invites a first render instead of promising one later", () => {
    inBrowser(<GenerationTimeline generations={[]} />);
    expect(screen.getByText(/It renders in this tab/)).toBeDefined();
  });

  it("says where the render runs and what it takes, before any launch", () => {
    const model = option({});
    inBrowser(<LaunchPanel {...panel} options={[model]} model={model} />);
    expect(screen.getByText("Note about rendering here")).toBeDefined();
    expect(screen.getByText("Runs in this browser.")).toBeDefined();
  });

  it("explains why this browser cannot render, with the way out", () => {
    const blocked = option({ available: false, unavailableReason: "This browser cannot render video. This browser has no WebCodecs encoder." });
    inBrowser(<LaunchPanel {...panel} options={[blocked]} model={null} />);
    expect(screen.getByText(/has no WebCodecs encoder/)).toBeDefined();
    expect(screen.getByRole("link", { name: /set up the self-hosted studio/ })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Launch draft" })).toBeNull();
  });
});

describe("the browser edition's data in Settings", () => {
  it("shows the storage used and asks the browser to keep it", async () => {
    render(<LocalDataSettings data={localData()} />);
    expect(await screen.findByText("48 MB")).toBeDefined();
    expect(screen.getByText("120 GB")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Keep it on this device" }));
    expect(await screen.findByText(/will not clear it/)).toBeDefined();
  });

  it("says so when the browser declines to keep it, and when it reports nothing", async () => {
    const data = localData({ storage: { estimate: async () => null, persisted: async () => false, persist: async () => false } });
    render(<LocalDataSettings data={data} />);
    expect(await screen.findByText(/does not say how much space/)).toBeDefined();
    fireEvent.click(await screen.findByRole("button", { name: "Keep it on this device" }));
    expect(await screen.findByText(/The browser said no for now/)).toBeDefined();
  });

  it("exports everything as one file", async () => {
    const data = localData();
    URL.createObjectURL = vi.fn(() => "blob:backup");
    URL.revokeObjectURL = vi.fn();
    render(<LocalDataSettings data={data} />);
    fireEvent.click(screen.getByRole("button", { name: "Export data" }));
    expect(await screen.findByText("Saved troupe-backup-2026-10-05-0945.tar (1 bytes).")).toBeDefined();
    expect(data.exportBackup).toHaveBeenCalledOnce();
  });

  it("imports a backup only once its contents are confirmed", async () => {
    const restore = vi.fn(async () => {});
    const data = localData({ readBackup: vi.fn(async () => ({ summary: { createdAt: new Date(2026, 9, 5, 9, 45), projects: 3, videos: 1, bytes: 4_200_000 }, restore })) });
    render(<LocalDataSettings data={data} />);
    const file = new File(["tar"], "troupe-backup.tar");
    fireEvent.change(screen.getByLabelText("Backup file to import"), { target: { files: [file] } });
    const question = await screen.findByRole("alertdialog");
    expect(question.textContent).toMatch(/3 projects and 1 video \(4\.2 MB\)/);
    expect(restore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.change(screen.getByLabelText("Backup file to import"), { target: { files: [file] } });
    fireEvent.click(await screen.findByRole("button", { name: "Replace with backup" }));
    await waitFor(() => expect(restore).toHaveBeenCalledOnce());
  });

  it("says why a file cannot be imported", async () => {
    const data = localData({ readBackup: vi.fn(async () => { throw new Error("This file is not a Troupe backup."); }) });
    render(<LocalDataSettings data={data} />);
    fireEvent.change(screen.getByLabelText("Backup file to import"), { target: { files: [new File(["x"], "notes.txt")] } });
    expect((await screen.findByRole("alert")).textContent).toBe("This file is not a Troupe backup.");
  });

  it("deletes everything after a clear confirmation", async () => {
    const data = localData();
    render(<LocalDataSettings data={data} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete all local data" }));
    expect(screen.getByRole("alertdialog").textContent).toMatch(/cannot be undone/);
    fireEvent.click(screen.getByRole("button", { name: "Delete everything" }));
    await waitFor(() => expect(data.deleteAll).toHaveBeenCalledOnce());
  });

  it("says where the data lives once, until the note is dismissed", () => {
    localStorage.clear();
    const { unmount } = render(<LocalDataSettings data={localData()} />);
    expect(screen.getByText(/your projects stay on this device/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/your projects stay on this device/)).toBeNull();
    unmount();
    render(<LocalDataSettings data={localData()} />);
    expect(screen.queryByText(/your projects stay on this device/)).toBeNull();
  });

  it("leaves the size out of a backup with no videos", async () => {
    const data = localData({ readBackup: vi.fn(async () => ({ summary: { createdAt: new Date(2026, 9, 5, 9, 45), projects: 1, videos: 0, bytes: 0 }, restore: vi.fn(async () => {}) })) });
    render(<LocalDataSettings data={data} />);
    fireEvent.change(screen.getByLabelText("Backup file to import"), { target: { files: [new File(["x"], "b.tar")] } });
    expect((await screen.findByRole("alertdialog")).textContent).toMatch(/It holds 1 project, saved /);
  });

  it("formats sizes with two significant figures", () => {
    expect([formatBytes(512), formatBytes(4_200_000), formatBytes(48_230_000), formatBytes(326_000_000), formatBytes(1.24e9)]).toEqual(["512 bytes", "4.2 MB", "48 MB", "326 MB", "1.2 GB"]);
  });
});
