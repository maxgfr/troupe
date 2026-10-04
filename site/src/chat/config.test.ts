import { describe, expect, it } from "vitest";

import { DEFAULT_CHAT_CONFIG, parseChatConfig } from "./config";
import { readProgress } from "./webllm";

const KNOWN = ["Qwen2.5-1.5B-Instruct-q4f16_1-MLC", "Qwen2.5-1.5B-Instruct-q4f32_1-MLC", "Qwen3-1.7B-q4f16_1-MLC", "Llama-3.2-1B-Instruct-q4f32_1-MLC"];

describe("parseChatConfig", () => {
  it("uses the defaults when nothing is set", () => {
    expect(parseChatConfig({}, KNOWN)).toEqual(DEFAULT_CHAT_CONFIG);
    expect(parseChatConfig({ VITE_WEBLLM_MODEL: " " })).toEqual(DEFAULT_CHAT_CONFIG);
  });

  it("reads a fork's model, size, house style and speaking rate", () => {
    expect(parseChatConfig({ VITE_WEBLLM_MODEL: "Qwen3-1.7B-q4f16_1-MLC", VITE_WEBLLM_DOWNLOAD_MB: "1100", VITE_CHAT_INSTRUCTIONS: "No slang.", VITE_CHAT_WORDS_PER_SECOND: "2.2" }, KNOWN)).toEqual({
      model: "Qwen3-1.7B-q4f16_1-MLC",
      // No 32-bit build of it in the list.
      f32Model: null,
      downloadMb: 1100,
      instructions: "No slang.",
      wordsPerSecond: 2.2,
    });
    // A size measured for the default model is not shown for another one.
    expect(parseChatConfig({ VITE_WEBLLM_MODEL: "Llama-3.2-1B-Instruct-q4f32_1-MLC" }, KNOWN).downloadMb).toBe(0);
  });

  it("stops the build on a model WebLLM does not know, naming every problem", () => {
    expect(() => parseChatConfig({ VITE_WEBLLM_MODEL: "gpt-oss", VITE_CHAT_WORDS_PER_SECOND: "9" }, KNOWN)).toThrow(
      /VITE_WEBLLM_MODEL "gpt-oss" is not a WebLLM prebuilt model[\s\S]*VITE_CHAT_WORDS_PER_SECOND must be a number from 1 to 5/,
    );
  });
});

describe("WebLLM's progress", () => {
  it("reads the downloaded megabytes, then the load onto the GPU", () => {
    expect(readProgress({ progress: 0.25, timeElapsed: 3, text: "Fetching param cache[3/27]: 220MB fetched. 25% completed, 3 secs elapsed." })).toEqual({ stage: "download", fraction: 0.25, loadedMb: 220 });
    expect(readProgress({ progress: 0.5, timeElapsed: 3, text: "Loading model from cache[12/27]: 440MB loaded. 50% completed, 3 secs elapsed." })).toEqual({ stage: "load", fraction: 0.5 });
    expect(readProgress({ progress: 1, timeElapsed: 9, text: "Finish loading on WebGPU - apple" })).toEqual({ stage: "ready" });
  });
});
