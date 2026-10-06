// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VideoStill } from "./video-still";

// One IntersectionObserver the test drives by hand.
let observed: Element[] = [];
let callback: IntersectionObserverCallback = () => {};
class FakeObserver {
  constructor(cb: IntersectionObserverCallback) {
    callback = cb;
  }
  observe(el: Element) {
    observed.push(el);
  }
  disconnect() {
    observed = [];
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
}
const scrollIntoView = () =>
  act(() => callback(observed.map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry), {} as IntersectionObserver));

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  observed = [];
});

const fallback = <span data-testid="fallback" />;

describe("VideoStill", () => {
  it("fetches nothing until it is on screen, then shows an early frame", () => {
    const { container } = render(<VideoStill src="/api/media/a1" fallback={fallback} className="size-10" />);
    expect(container.querySelector("video")?.getAttribute("src") ?? null).toBeNull();
    scrollIntoView();
    expect(container.querySelector("video")!.getAttribute("src")).toBe("/api/media/a1#t=0.6");
    expect(container.querySelector("video")!.getAttribute("preload")).toBe("metadata");
  });

  it("shows the fallback instead of any video when the visitor saves data", () => {
    vi.stubGlobal("navigator", { ...navigator, connection: { saveData: true } });
    const { container, getByTestId } = render(<VideoStill src="/api/media/a1" fallback={fallback} />);
    scrollIntoView();
    expect(container.querySelector("video")).toBeNull();
    expect(getByTestId("fallback")).toBeDefined();
  });

  it("plays while active, and goes back to its frame when no longer", () => {
    const { container, rerender } = render(<VideoStill src="/api/media/a1" fallback={fallback} active={false} />);
    scrollIntoView();
    const video = container.querySelector("video")!;
    rerender(<VideoStill src="/api/media/a1" fallback={fallback} active />);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    video.currentTime = 3.2;
    rerender(<VideoStill src="/api/media/a1" fallback={fallback} active={false} />);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(video.currentTime).toBe(0.6);
  });

  it("falls back when the video cannot load", () => {
    const { container, getByTestId } = render(<VideoStill src="/api/media/gone" fallback={fallback} />);
    scrollIntoView();
    act(() => {
      container.querySelector("video")!.dispatchEvent(new Event("error"));
    });
    expect(getByTestId("fallback")).toBeDefined();
  });
});
