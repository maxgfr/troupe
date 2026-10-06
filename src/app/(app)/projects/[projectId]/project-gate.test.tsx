// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

// A project page for a project that does not exist (deleted, or a mistyped
// link) is the studio's not-found page, with its way back, rather than a
// project header over an error.
let result: { data?: unknown; error: { message: string; data?: { code?: string } } | null } = { error: null };
vi.mock("~/trpc/react", () => ({
  api: { studio: { getProject: { useQuery: () => result } } },
}));

import { ProjectGate } from "./project-gate";

afterEach(() => {
  cleanup();
  result = { error: null };
});

it("shows the not-found page when the project does not exist", () => {
  result = { error: { message: "project not found", data: { code: "NOT_FOUND" } } };
  render(<ProjectGate projectId="p1"><p>Project tabs</p></ProjectGate>);
  expect(screen.getByRole("heading", { name: "Page not found" })).toBeDefined();
  expect(screen.getByRole("link", { name: "Back to your projects" }).getAttribute("href")).toBe("/dashboard");
  expect(screen.queryByText("Project tabs")).toBeNull();
});

it("shows the page while the project loads, once it has, and on any other error", () => {
  render(<ProjectGate projectId="p1"><p>Project tabs</p></ProjectGate>);
  expect(screen.getByText("Project tabs")).toBeDefined();
  cleanup();
  result = { error: { message: "Database unavailable", data: { code: "INTERNAL_SERVER_ERROR" } } };
  render(<ProjectGate projectId="p1"><p>Project tabs</p></ProjectGate>);
  expect(screen.getByText("Project tabs")).toBeDefined();
});
