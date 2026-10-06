// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let workspaceError: { message: string } | null = null;

// AppShell: wordmark, global destinations and the workspace entry. tRPC and
// navigation are stubbed; the shell structure is what is under test.
vi.mock("~/trpc/react", () => ({
  api: {
    identity: {
      myWorkspaces: {
        useQuery: () => ({
          isPending: false,
          error: workspaceError,
          data: [{ id: "w1", name: "Acme Growth", ownerId: "u1" }],
        }),
      },
    },
  },
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push }),
}));

import { AppShell } from "./app-shell";
import { WorkspaceProvider } from "./workspace-context";

afterEach(() => {
  cleanup();
  workspaceError = null;
  push.mockClear();
});

describe("AppShell", () => {
  it("renders the wordmark, the sections (top bar and phone tab bar), New project and Settings", () => {
    render(
      <WorkspaceProvider>
        <AppShell>
          <p>stage</p>
        </AppShell>
      </WorkspaceProvider>,
    );
    expect(screen.getByLabelText("troupe — home")).toBeDefined();
    for (const nav of [
      screen.getByRole("navigation", { name: "Primary" }),
      screen.getByRole("navigation", { name: "Sections" }),
    ]) {
      expect(
        within(nav)
          .getAllByRole("link")
          .map((l) => l.textContent),
      ).toEqual(["Projects", "Library", "Actors", "Compare"]);
    }
    expect(screen.getByRole("link", { name: "New project" }).getAttribute("href")).toBe("/projects/new");
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings");
    expect(screen.getByText("stage")).toBeDefined();
  });

  it("goes places from the keyboard, never while typing, and lists the shortcuts", () => {
    render(
      <WorkspaceProvider>
        <AppShell>
          <input aria-label="Somewhere to type" />
        </AppShell>
      </WorkspaceProvider>,
    );
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "l" });
    expect(push).toHaveBeenCalledWith("/library");
    fireEvent.keyDown(window, { key: "n" });
    expect(push).toHaveBeenCalledWith("/projects/new");
    push.mockClear();
    fireEvent.keyDown(screen.getByLabelText("Somewhere to type"), { key: "n" });
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    expect(push).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.getByRole("heading", { name: "Keyboard shortcuts" })).toBeDefined();
  });

  it("does nothing while a dialog is open, whatever holds the focus", () => {
    render(
      <WorkspaceProvider>
        <AppShell>
          <p>x</p>
        </AppShell>
      </WorkspaceProvider>,
    );
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.getByRole("heading", { name: "Keyboard shortcuts" })).toBeDefined();
    fireEvent.keyDown(document.body, { key: "n" });
    fireEvent.keyDown(document.body, { key: "g" });
    fireEvent.keyDown(document.body, { key: "p" });
    expect(push).not.toHaveBeenCalled();
  });

  it("marks the active destination with aria-current", () => {
    render(
      <WorkspaceProvider>
        <AppShell>
          <p>x</p>
        </AppShell>
      </WorkspaceProvider>,
    );
    for (const active of screen.getAllByRole("link", { name: "Projects" })) {
      expect(active.getAttribute("aria-current")).toBe("page");
    }
    expect(screen.getAllByRole("link", { name: "Library" })[0]!.getAttribute("aria-current")).toBeNull();
  });
});

it("shows a recoverable workspace error instead of mounting broken pages", () => {
  workspaceError = { message: "Database unavailable" };
  render(
    <WorkspaceProvider>
      <AppShell>
        <p>Project controls</p>
      </AppShell>
    </WorkspaceProvider>,
  );
  expect(screen.getByRole("alert").textContent).toContain("Database unavailable");
  expect(screen.getByRole("button", { name: "Reload studio" })).toBeDefined();
  expect(screen.queryByText("Project controls")).toBeNull();
});
