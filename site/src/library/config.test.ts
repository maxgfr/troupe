import { describe, expect, it } from "vitest";

import { DEFAULT_LIBRARY_CONFIG, parseLibraryConfig } from "./config";

describe("the browser edition's library settings", () => {
  it("defaults to Whisper base and multilingual-e5-small in 8-bit on the CPU", () => {
    expect(parseLibraryConfig({})).toEqual(DEFAULT_LIBRARY_CONFIG);
  });

  it("takes other models, and forgets the download size measured for the defaults", () => {
    expect(parseLibraryConfig({ VITE_LIBRARY_WHISPER_MODEL: "onnx-community/whisper-tiny", VITE_LIBRARY_DEVICE: "auto", VITE_LIBRARY_FRAMES: "4", VITE_LIBRARY_MAX_MINUTES: "30" })).toMatchObject({ whisperModel: "onnx-community/whisper-tiny", device: "auto", frames: 4, downloadMb: 0, maxMinutes: 30 });
  });

  it("stops the build on a bad value, naming it", () => {
    const bad = () => parseLibraryConfig({ VITE_LIBRARY_EMBED_MODEL: "not a model", VITE_LIBRARY_WHISPER_DTYPE: "q3", VITE_LIBRARY_DEVICE: "gpu", VITE_LIBRARY_MAX_UPLOAD_MB: "0", VITE_LIBRARY_MAX_MINUTES: "0" });
    for (const name of ["VITE_LIBRARY_EMBED_MODEL", "VITE_LIBRARY_WHISPER_DTYPE", "VITE_LIBRARY_DEVICE", "VITE_LIBRARY_MAX_UPLOAD_MB", "VITE_LIBRARY_MAX_MINUTES"]) expect(bad).toThrow(name);
  });
});
