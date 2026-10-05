// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ActorPortrait } from "./actor-portrait";

afterEach(cleanup);

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

  it("shows the initials for an actor without a picture", () => {
    render(<ActorPortrait {...props} src={null} />);
    expect(screen.getByRole("img", { name: props.label }).tagName.toLowerCase()).toBe("svg");
  });
});
