import { afterEach, describe, expect, it, vi } from "vitest";

import { seekTo, type Seekable } from "./seek";

// A video element as far as seeking goes: its time, how much it has loaded,
// and the events it fires.
class FakeVideo extends EventTarget implements Seekable {
  readyState = 1;
  sets: number[] = [];
  #time = 0;
  get currentTime() {
    return this.#time;
  }
  set currentTime(value: number) {
    this.sets.push(value);
    this.#time = value;
  }
}

afterEach(() => vi.useRealTimers());

describe("seeking a video for a picture", () => {
  it("waits for the seek to land", async () => {
    const video = new FakeVideo();
    const landing = seekTo(video, 6, { timeoutMs: 1000 });
    expect(video.sets).toEqual([6]);
    video.readyState = 2;
    video.dispatchEvent(new Event("seeked"));
    await expect(landing).resolves.toBeUndefined();
  });

  it("does not seek where the video already is, but waits for its picture when it has none yet", async () => {
    const video = new FakeVideo();
    const opening = seekTo(video, 0, { timeoutMs: 1000 });
    expect(video.sets).toEqual([]);
    video.readyState = 2;
    video.dispatchEvent(new Event("loadeddata"));
    await expect(opening).resolves.toBeUndefined();

    // Already there with a picture: nothing to wait for.
    await expect(seekTo(video, 0, { timeoutMs: 1000 })).resolves.toBeUndefined();
    expect(video.sets).toEqual([]);
  });

  it("gives up when the browser never lands, saying where", async () => {
    vi.useFakeTimers();
    const video = new FakeVideo();
    const stuck = seekTo(video, 75, { timeoutMs: 5000 });
    vi.advanceTimersByTime(5001);
    await expect(stuck).rejects.toThrow("This browser stopped reading the video at 1:15.");
  });

  it("stops when the analysis is stopped", async () => {
    const video = new FakeVideo();
    const stop = new AbortController();
    const seeking = seekTo(video, 3, { timeoutMs: 1000, signal: stop.signal });
    stop.abort(new Error("The item was deleted."));
    await expect(seeking).rejects.toThrow("The item was deleted.");
  });
});
