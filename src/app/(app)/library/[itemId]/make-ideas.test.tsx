// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let status: {
  isPending: boolean;
  error: { message: string } | null;
  data?: { ideas: number; tools: { name: string; ready: boolean; detail: string }[] };
};
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ library: { ideas: { list: { invalidate: vi.fn() } } } }),
    library: {
      status: { useQuery: () => status },
      ideas: { generate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
    },
    actors: { list: { useQuery: () => ({ data: [] }) } },
  },
}));

import { MakeIdeas } from "./make-ideas";

afterEach(cleanup);

const props = { workspaceId: "w1", itemId: "i1", ready: true, browser: false };

describe("making ideas from an item", () => {
  it("waits for the studio to say how many ideas a set holds", () => {
    status = { isPending: true, error: null };
    const { container } = render(<MakeIdeas {...props} />);
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /ideas in this style/ })).toBeNull();
  });

  it("names the set's size once it knows it", () => {
    status = {
      isPending: false,
      error: null,
      data: { ideas: 6, tools: [{ name: "writer", ready: true, detail: "" }] },
    };
    render(<MakeIdeas {...props} />);
    expect(screen.getByRole("button", { name: "6 ideas in this style" })).toBeDefined();
  });

  it("says why, instead of waiting forever, when the studio cannot say", () => {
    status = { isPending: false, error: { message: "The library is off." } };
    const { container } = render(<MakeIdeas {...props} />);
    expect(container.querySelector(".animate-pulse")).toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(/Ideas cannot be written right now: The library is off\./);
    expect((screen.getByRole("button", { name: "Remix the hook" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
