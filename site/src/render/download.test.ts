import { describe, expect, it } from "vitest";

import { trackDownload } from "./download";
import type { DownloadProgress } from "./tts";

const progress = (file: string, loaded: number, total: number) => ({ status: "progress" as const, name: "m", file, progress: (100 * loaded) / total, loaded, total });

describe("trackDownload", () => {
  it("adds up every file of one load", () => {
    const seen: DownloadProgress[] = [];
    const { onEvent } = trackDownload("webgpu", (p) => seen.push(p));
    onEvent(progress("config.json", 1_000, 1_000));
    onEvent(progress("onnx/model.onnx", 100_000_000, 326_000_000));
    onEvent({ status: "done", name: "m", file: "config.json" });
    expect(seen.at(-1)).toEqual({ loadedBytes: 100_001_000, totalBytes: 326_001_000, device: "webgpu" });
  });

  it("drops a load given up for another, so its sizes never join the new total", () => {
    const seen: DownloadProgress[] = [];
    const gpu = trackDownload("webgpu", (p) => seen.push(p));
    gpu.onEvent(progress("onnx/model.onnx", 326_000_000, 326_000_000));
    gpu.stop();
    const cpu = trackDownload("wasm", (p) => seen.push(p));
    cpu.onEvent(progress("onnx/model_quantized.onnx", 10_000_000, 92_000_000));
    // The abandoned load's tokenizer still reports after the fallback began.
    gpu.onEvent(progress("tokenizer.json", 5_000, 5_000));
    expect(seen.at(-1)).toEqual({ loadedBytes: 10_000_000, totalBytes: 92_000_000, device: "wasm" });
  });
});
