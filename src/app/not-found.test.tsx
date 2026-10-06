// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The self-hosted studio's answer to an address it does not know: the same
// page the browser edition shows (docs/PRODUCT-MAP.md, "any other"), inside
// the studio's navigation, never the framework's bare 404.
vi.mock("~/trpc/react", () => ({
  api: {
    identity: {
      myWorkspaces: {
        useQuery: () => ({ isPending: false, error: null, data: [{ id: "w1", name: "Studio", ownerId: "u1" }] }),
      },
    },
  },
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/no-such-page", useRouter: () => ({ push: vi.fn() }) }));

import { EditionProvider } from "./_components/edition";
import { NotFoundPage } from "./_components/not-found-page";
import NotFound, { metadata } from "./not-found";

afterEach(cleanup);

describe("the not-found page", () => {
  it("names the page in the studio's shell and leads back to the projects", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeDefined();
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Back to your projects" }).getAttribute("href")).toBe("/dashboard");
    expect(screen.getByText(/deleted from this studio/)).toBeDefined();
    expect(document.title).toBe("Page not found · Troupe");
    // The server's title too: Next sets it after the page's own effect.
    expect(metadata).toEqual({ title: "Page not found" });
  });

  it("speaks of this browser in the browser edition", () => {
    render(
      <EditionProvider value={{ kind: "browser", data: {} as never }}>
        <NotFoundPage />
      </EditionProvider>,
    );
    expect(screen.getByText(/deleted from this browser/)).toBeDefined();
  });
});
