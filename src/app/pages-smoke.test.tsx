// @vitest-environment jsdom
// Smoke render per screen: each page must mount and show its header while
// data loads.
import { Suspense } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/app/_components/workspace-context", () => ({
  useWorkspace: () => ({ status: "ready", workspaceId: "ws1" }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ identity: { myWorkspaces: { invalidate: vi.fn() } }, generation: { forProject: { invalidate: vi.fn() } }, script: { history: { invalidate: vi.fn() } } }),
    identity: {
      myWorkspaces: { useQuery: () => ({ isPending: true }) },
    },
    studio: {
      updateChoices: { useMutation: () => ({}) },
      getProject: { useQuery: () => ({ isPending: true }) },
      modelOptions: { useQuery: () => ({ isPending: true }) },
      deleteProject: { useMutation: () => ({}) },
    },
    script: {
      history: { useQuery: () => ({ isPending: true }) },
    },
    generation: {
      forProject: { useQuery: () => ({ isPending: true }) },
      launchText: { useMutation: () => ({}) },
      relaunch: { useMutation: () => ({}) },
    },
    benchmark: { start: { useMutation: () => ({}) } },
    settings: {
      chat: {
        get: { useQuery: () => ({ isPending: true }) },
        save: { useMutation: () => ({}) },
        test: { useMutation: () => ({}) },
      },
      credentials: {
        status: { useQuery: () => ({ isPending: true }) },
        save: { useMutation: () => ({}) },
        clear: { useMutation: () => ({}) },
        test: { useMutation: () => ({}) },
      },
      models: {
        list: { useQuery: () => ({ isPending: true }) },
        update: { useMutation: () => ({}) },
        test: { useMutation: () => ({}) },
        archive: { useMutation: () => ({}) },
        setDefault: { useMutation: () => ({}) },
        connections: { useQuery: () => ({ isPending: true }) },
        updateLocal: { useMutation: () => ({}) },
        templates: { useQuery: () => ({ isPending: true }) },
        suggestedAddress: { useQuery: () => ({ isPending: true }) },
        testDraft: { useMutation: () => ({}) },
        createLocal: { useMutation: () => ({}) },
      },
    },
    ops: {
      reconcileHeartbeat: { useQuery: () => ({ isPending: true }) },
    },
  },
}));

import SettingsPage from "./(app)/settings/page";
import MonitorPage from "./(app)/projects/[projectId]/page";

function fulfilledParams(projectId: string) {
  return Object.assign(Promise.resolve({ projectId }), {
    status: "fulfilled" as const,
    value: { projectId },
  });
}

afterEach(cleanup);

describe("screen smoke renders", () => {
  it("Generation monitor mounts and shows its header while the project loads", () => {
    render(
      <Suspense fallback={<p>suspense…</p>}>
        <MonitorPage params={fulfilledParams("p1")} />
      </Suspense>,
    );
    // While the project loads the header shows the neutral "Project" title.
    expect(screen.getByText("Project")).toBeDefined();
  });

  it("Settings mounts and shows its header while the workspace loads", () => {
    render(<SettingsPage />);
    expect(screen.getByText("Settings")).toBeDefined();
  });
});
