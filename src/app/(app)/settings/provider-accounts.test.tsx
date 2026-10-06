// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

// A key test's verdict belongs to the key it tested: once that key is removed
// or replaced, the verdict goes with it.
type Source = "saved" | "none";
const state: { google: Source } = { google: "saved" };
const status = () => ({
  google: { source: state.google, configured: state.google === "saved" },
  fal: { source: "none", configured: false },
  anthropic: { source: "none", configured: false },
});
let rerender: () => void = () => {};

function mutation(run: (input: { provider: "google" }) => unknown) {
  return (options: { onSuccess?: (data: unknown, input: { provider: "google" }) => unknown }) => ({
    isPending: false,
    error: null,
    variables: undefined,
    mutate: (input: { provider: "google" }) => {
      const data = run(input);
      act(() => {
        void options.onSuccess?.(data, input);
      });
      rerender();
    },
  });
}

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      settings: {
        credentials: { status: { invalidate: async () => {} } },
        models: { list: { invalidate: async () => {} } },
        chat: { get: { invalidate: async () => {} } },
      },
      studio: { modelOptions: { invalidate: async () => {} } },
    }),
    settings: {
      credentials: {
        status: { useQuery: () => ({ data: status(), error: null }) },
        save: {
          useMutation: mutation(() => {
            state.google = "saved";
          }),
        },
        clear: {
          useMutation: mutation(() => {
            state.google = "none";
          }),
        },
        test: { useMutation: mutation(() => ({ ok: false, message: "Google rejected this API key." })) },
      },
    },
  },
}));

import { ProviderAccounts } from "./provider-accounts";

afterEach(() => {
  cleanup();
  state.google = "saved";
});

it("forgets a key's test result once the key is removed", () => {
  const view = render(<ProviderAccounts />);
  rerender = () => view.rerender(<ProviderAccounts />);
  fireEvent.click(screen.getByRole("button", { name: "Test" }));
  expect(screen.getByText("Google rejected this API key.")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  expect(screen.getAllByText("Not configured")).toHaveLength(3);
  expect(screen.queryByText("Google rejected this API key.")).toBeNull();
});

it("forgets it when a replacement key is saved", () => {
  const view = render(<ProviderAccounts />);
  rerender = () => view.rerender(<ProviderAccounts />);
  fireEvent.click(screen.getByRole("button", { name: "Test" }));
  fireEvent.change(screen.getByLabelText("Google AI API key"), { target: { value: "another-key" } });
  fireEvent.submit(screen.getByLabelText("Google AI API key").closest("form")!);
  expect(screen.queryByText("Google rejected this API key.")).toBeNull();
});
