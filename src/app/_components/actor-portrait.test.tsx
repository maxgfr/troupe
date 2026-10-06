// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActorPortrait } from "./actor-portrait";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const props = { id: "a1", name: "Léa Martin", label: "Léa Martin — casual, 25-34" };

describe("ActorPortrait", () => {
  it("shows the actor's picture, lazily, described by the label", () => {
    const { container } = render(<ActorPortrait {...props} src="/actors/lea-01/v1/front.webp" />);
    const picture = screen.getByRole("img", { name: props.label }) as HTMLImageElement;
    expect(picture.tagName).toBe("IMG");
    expect(picture.getAttribute("src")).toBe("/actors/lea-01/v1/front.webp");
    expect(picture.getAttribute("loading")).toBe("lazy");
    expect(picture.getAttribute("decoding")).toBe("async");
    // The initials wait underneath, out of the accessibility tree.
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(container.textContent).toContain("LM");
  });

  it("falls back to the initials when the picture cannot load", () => {
    render(<ActorPortrait {...props} src="/actors/missing.webp" />);
    fireEvent.error(screen.getByRole("img", { name: props.label }));
    const fallback = screen.getByRole("img", { name: props.label });
    expect(fallback.tagName.toLowerCase()).toBe("svg");
    expect(fallback.textContent).toBe("LM");
  });

  it("offers the 160 and 320 px copies for the width it shows, early when asked", () => {
    render(<ActorPortrait {...props} src="/actors/lea-01/v1/front.webp" sizes="80px" priority />);
    const picture = screen.getByRole("img", { name: props.label });
    expect(picture.getAttribute("srcset")).toBe("/actors/lea-01/v1/front-160.webp 160w, /actors/lea-01/v1/front-320.webp 320w, /actors/lea-01/v1/front.webp 768w");
    expect(picture.getAttribute("sizes")).toBe("80px");
    expect(picture.getAttribute("loading")).toBe("eager");
    expect(picture.getAttribute("fetchpriority")).toBe("high");
  });

  it("drops the copies when a cast folder lacks them, then the initials if the picture is missing too", () => {
    render(<ActorPortrait {...props} src="/actors/custom-01/v1/front.webp" />);
    fireEvent.error(screen.getByRole("img", { name: props.label }));
    const full = screen.getByRole("img", { name: props.label });
    expect(full.tagName).toBe("IMG");
    expect(full.getAttribute("srcset")).toBeNull();
    fireEvent.error(full);
    expect(screen.getByRole("img", { name: props.label }).tagName.toLowerCase()).toBe("svg");
  });

  it("shows the initials for an actor without a picture", () => {
    render(<ActorPortrait {...props} src={null} />);
    expect(screen.getByRole("img", { name: props.label }).tagName.toLowerCase()).toBe("svg");
  });

  it("fades the picture in and drops the initials once it has loaded", () => {
    const { container } = render(<ActorPortrait {...props} src="/actors/lea-01/v1/front.webp" />);
    const picture = screen.getByRole("img", { name: props.label });
    expect(picture.className).toContain("opacity-0");
    fireEvent.load(picture);
    expect(picture.className).toContain("opacity-100");
    expect(container.textContent).not.toContain("LM");
  });

  it("shows a picture the browser already had, whose load event came before React listened", () => {
    // A cached picture is complete as soon as the element is created.
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(768);
    const { container } = render(<ActorPortrait {...props} src="/actors/lea-01/v1/front.webp" />);
    expect(screen.getByRole("img", { name: props.label }).className).toContain("opacity-100");
    expect(container.textContent).not.toContain("LM");
  });
});
