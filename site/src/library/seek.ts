import { formatTimestamp } from "~/modules/library/text";

// Moves a video element to a time and waits until its picture there can be
// drawn. Setting currentTime to where the video already is fires no
// "seeked", so that case waits for the first picture instead (or nothing,
// when it is there). A browser that never lands gives up after `timeoutMs`.

export interface Seekable extends EventTarget {
  currentTime: number;
  readyState: number;
}

// HTMLMediaElement.HAVE_CURRENT_DATA: the picture at currentTime is there.
const HAVE_CURRENT_DATA = 2;

export function seekTo(video: Seekable, atS: number, options: { timeoutMs: number; signal?: AbortSignal }): Promise<void> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(options.signal.reason);
    const there = Math.abs(video.currentTime - atS) < 0.001;
    if (there && video.readyState >= HAVE_CURRENT_DATA) return resolve();
    const finish = (error?: unknown) => {
      clearTimeout(timer);
      video.removeEventListener("seeked", landed);
      video.removeEventListener("loadeddata", landed);
      video.removeEventListener("error", failed);
      options.signal?.removeEventListener("abort", stopped);
      if (error === undefined) resolve();
      else reject(error);
    };
    const landed = () => finish();
    const failed = () => finish(new Error(`This browser could not read the video at ${formatTimestamp(atS)}.`));
    const stopped = () => finish(options.signal?.reason ?? new Error("Stopped."));
    const timer = setTimeout(() => finish(new Error(`This browser stopped reading the video at ${formatTimestamp(atS)}.`)), options.timeoutMs);
    video.addEventListener("seeked", landed);
    video.addEventListener("loadeddata", landed);
    video.addEventListener("error", failed);
    options.signal?.addEventListener("abort", stopped);
    if (!there) video.currentTime = atS;
  });
}
