import { afterEach, describe, expect, it, vi } from "vitest";

import { startLoop } from "./loop";

afterEach(() => vi.useRealTimers());

describe("background loop", () => {
  it("runs one pass at a time, survives a failing pass and starts only once", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let calls = 0;
    const tick = vi.fn(async () => {
      calls++;
      if (calls === 2) throw new Error("database restarting");
    });
    const stop = startLoop("test-loop", tick, 1000);
    expect(startLoop("test-loop", tick, 1000)).toBe(stop);
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(3);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(tick).toHaveBeenCalledTimes(3);
  });
});
