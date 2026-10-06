import { describe, expect, it } from "vitest";

import { DEFAULT_RENDER_CONFIG, parseRenderConfig } from "./config";

describe("parseRenderConfig", () => {
  it("uses the defaults when nothing is set, empty values included", () => {
    expect(parseRenderConfig({})).toEqual(DEFAULT_RENDER_CONFIG);
    expect(parseRenderConfig({ VITE_KOKORO_DEVICE: "", VITE_RENDER_FPS: " " })).toEqual(DEFAULT_RENDER_CONFIG);
  });

  it("reads every setting a fork may change", () => {
    const config = parseRenderConfig({
      VITE_KOKORO_MODEL: "my-org/Kokoro-82M-ONNX",
      VITE_KOKORO_DEVICE: "wasm",
      VITE_KOKORO_DTYPE_WEBGPU: "fp16",
      VITE_KOKORO_DTYPE_WASM: "q4f16",
      VITE_KOKORO_VOICES: "female=af_sky;male=am_adam,bm_lewis",
      VITE_RENDER_FPS: "30",
      VITE_RENDER_VIDEO_BITRATE: "4000000",
      VITE_RENDER_KEYFRAME_S: "0.5",
      VITE_RENDER_AUDIO_BITRATE: "96000",
      VITE_RENDER_AUDIO_CODECS: "opus, aac",
      VITE_SCENE_HUE: "210",
      VITE_SCENE_FONT_URL: "fonts/Inter.woff2",
    });
    expect(config).toEqual({
      kokoroModel: "my-org/Kokoro-82M-ONNX",
      device: "wasm",
      dtype: { webgpu: "fp16", wasm: "q4f16" },
      voices: { female: ["af_sky"], male: ["am_adam", "bm_lewis"] },
      fps: 30,
      videoBitrate: 4_000_000,
      keyFrameIntervalS: 0.5,
      audioBitrate: 96_000,
      audioCodecs: ["opus", "aac"],
      sceneHue: 210,
      sceneFontUrl: "fonts/Inter.woff2",
    });
    expect(parseRenderConfig({ VITE_RENDER_VIDEO_BITRATE: "medium" }).videoBitrate).toBe("medium");
    // A path stays under the site's base: no step up out of it.
    for (const outside of ["../Inter.woff2", "fonts/../../Inter.woff2", "fonts/..", ".."])
      expect(() => parseRenderConfig({ VITE_SCENE_FONT_URL: outside }), outside).toThrow(/VITE_SCENE_FONT_URL/);
    expect(parseRenderConfig({ VITE_SCENE_FONT_URL: "https://fonts.example.com/Inter.ttf" }).sceneFontUrl).toBe(
      "https://fonts.example.com/Inter.ttf",
    );
  });

  it("names every bad value at once", () => {
    let message = "";
    try {
      parseRenderConfig({
        VITE_KOKORO_MODEL: "not a model",
        VITE_KOKORO_DEVICE: "gpu",
        VITE_KOKORO_DTYPE_WASM: "int3",
        VITE_KOKORO_VOICES: "female=af_sky",
        VITE_RENDER_FPS: "0",
        VITE_RENDER_VIDEO_BITRATE: "best",
        VITE_RENDER_AUDIO_CODECS: "mp3",
        VITE_SCENE_HUE: "400",
        VITE_SCENE_FONT_URL: "/etc/fonts.conf",
      });
    } catch (error) {
      message = (error as Error).message;
    }
    for (const name of [
      "VITE_KOKORO_MODEL",
      "VITE_KOKORO_DEVICE",
      "VITE_KOKORO_DTYPE_WASM",
      "VITE_KOKORO_VOICES",
      "VITE_RENDER_FPS",
      "VITE_RENDER_VIDEO_BITRATE",
      "VITE_RENDER_AUDIO_CODECS",
      "VITE_SCENE_HUE",
      "VITE_SCENE_FONT_URL",
    ]) {
      expect(message).toContain(name);
    }
  });
});
