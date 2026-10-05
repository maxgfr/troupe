import { describe, expect, it } from "vitest";

import { anthropicFallbackAllowed, chatEnvironment } from "./index";

describe("chatEnvironment", () => {
  it("has a documented default for every setting", () => {
    expect(chatEnvironment({})).toEqual({
      provider: "auto",
      ollamaUrl: "http://127.0.0.1:11434",
      ollamaModel: "qwen3:4b",
      anthropicModel: "claude-opus-5-5",
      instructions: "",
      wordsPerSecond: 2.5,
      timeoutMs: 180_000,
      temperature: null,
      historyTurns: 6,
      anthropicFallback: "auto",
    });
  });

  it("reads each variable, and falls back on a bad value", () => {
    expect(chatEnvironment({ TROUPE_CHAT_PROVIDER: "anthropic", TROUPE_CHAT_TEMPERATURE: "0.8", TROUPE_CHAT_HISTORY_TURNS: "2", TROUPE_CHAT_WORDS_PER_SECOND: "2.2", TROUPE_CHAT_TIMEOUT_S: "60" })).toMatchObject({
      provider: "anthropic",
      temperature: 0.8,
      historyTurns: 2,
      wordsPerSecond: 2.2,
      timeoutMs: 60_000,
    });
    expect(chatEnvironment({ TROUPE_CHAT_PROVIDER: "gpt", TROUPE_CHAT_TEMPERATURE: "9", TROUPE_CHAT_HISTORY_TURNS: "-1" })).toMatchObject({ provider: "auto", temperature: null, historyTurns: 6 });
    expect(chatEnvironment({ TROUPE_CHAT_ANTHROPIC_FALLBACK: " off " }).anthropicFallback).toBe("off");
    expect(chatEnvironment({ TROUPE_CHAT_ANTHROPIC_FALLBACK: "maybe" }).anthropicFallback).toBe("auto");
  });
});

describe("the server-side fallback", () => {
  it("goes to Anthropic's own API only, unless set on or off", () => {
    expect(anthropicFallbackAllowed("auto", undefined)).toBe(true);
    expect(anthropicFallbackAllowed("auto", "")).toBe(true);
    expect(anthropicFallbackAllowed("auto", "https://api.anthropic.com")).toBe(true);
    expect(anthropicFallbackAllowed("auto", "https://api.anthropic.com/")).toBe(true);
    // A gateway or proxy may not know the beta, and refuse the whole request.
    expect(anthropicFallbackAllowed("auto", "https://llm-gateway.example.com/anthropic")).toBe(false);
    expect(anthropicFallbackAllowed("auto", "not a url")).toBe(false);
    expect(anthropicFallbackAllowed("on", "https://llm-gateway.example.com/anthropic")).toBe(true);
    expect(anthropicFallbackAllowed("off", undefined)).toBe(false);
  });
});
