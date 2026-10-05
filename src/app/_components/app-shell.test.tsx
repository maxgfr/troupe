// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let workspaceError: { message: string } | null = null;

// AppShell: wordmark, global destinations and the workspace entry. tRPC and
// navigation are stubbed; the shell structure is what is under test.
vi.mock("~/trpc/react", () => ({
  api: {
    identity: {
      myWorkspaces: {
        useQuery: () => ({ isPending: false, error: workspaceError, data: [{ id: "w1", name: "Acme Growth", ownerId: "u1" }] }),
      },
    },
  },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn() }),
}));

import { AppShell } from "./app-shell";
import { WorkspaceProvider } from "./workspace-context";

afterEach(() => { cleanup(); workspaceError = null; });

describe("AppShell", () => {
  it("renders wordmark, primary nav and the personal studio entry", () => {
    render(
      <WorkspaceProvider>
        <AppShell>
          <p>stage</p>
        </AppShell>
      </WorkspaceProvider>,
    );
    expect(screen.getByLabelText("troupe — home")).toBeDefined();
    for (const label of ["Dashboard", "Library", "Actors", "Benchmark"]) {
      expect(screen.getByRole("link", { name: label })).toBeDefined();
    }
    expect(screen.getByRole("link", { name: "Acme Growth" })).toBeDefined();
    expect(screen.getByText("stage")).toBeDefined();
  });

  it("marks the active destination with aria-current", () => {
    render(
      <WorkspaceProvider>
        <AppShell>
          <p>x</p>
        </AppShell>
      </WorkspaceProvider>,
    );
    const active = screen.getAllByRole("link", { name: "Dashboard" })[0]!;
    expect(active.getAttribute("aria-current")).toBe("page");
  });
});

it("shows a recoverable workspace error instead of mounting broken pages", () => {
  workspaceError = { message: "Database unavailable" };
  render(<WorkspaceProvider><AppShell><p>Project controls</p></AppShell></WorkspaceProvider>);
  expect(screen.getByRole("alert").textContent).toContain("Database unavailable");
  expect(screen.getByRole("button", { name: "Reload studio" })).toBeDefined();
  expect(screen.queryByText("Project controls")).toBeNull();
});
