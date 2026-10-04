// Every in-app <video> preview carries a real
// captions track built from the generation's own script — never a fake track.
import { describe, expect, it } from "vitest";

import { spokenLinesFromPrompt, spokenTextFromPrompt, vttFromLines, vttFromText } from "./captions";

const PROMPT = [
  "UGC-style ad, single actor speaking to camera.",
  "Voice: warm-direct. Language: en.",
  "Dialogue:",
  "[excited] (hook) Stop scrolling — this changes your mornings.",
  "[neutral] (body) One scoop, ten seconds, done.",
].join("\n");

describe("spokenTextFromPrompt", () => {
  it("extracts the spoken lines and strips emotion/role markers", () => {
    expect(spokenTextFromPrompt(PROMPT)).toBe(
      "Stop scrolling — this changes your mornings.\nOne scoop, ten seconds, done.",
    );
  });

  it("returns null when the prompt has no Dialogue section", () => {
    expect(spokenTextFromPrompt("free-form prompt")).toBeNull();
  });
});

describe("vttFromText", () => {
  it("builds a valid single-cue WEBVTT data URL spanning the clip", () => {
    const url = vttFromText("Hello there", 8);
    expect(url.startsWith("data:text/vtt")).toBe(true);
    const body = decodeURIComponent(url.split(",")[1]!);
    expect(body.startsWith("WEBVTT")).toBe(true);
    expect(body).toContain("00:00:00.000 --> 00:00:08.000");
    expect(body).toContain("Hello there");
  });

  it("clamps a missing duration to a sane minimum", () => {
    const body = decodeURIComponent(vttFromText("x", 0).split(",")[1]!);
    expect(body).toContain("00:00:00.000 --> 00:00:01.000");
  });
});

// Above the single-cue baseline — one cue per script line,
// prorated by word count over the clip duration.
describe("vttFromLines", () => {
  it("emits one cue per line, boundaries prorated by word count", () => {
    const body = decodeURIComponent(vttFromLines(["one two three", "four"], 8).split(",")[1]!);
    expect(body.startsWith("WEBVTT")).toBe(true);
    expect(body).toContain("00:00:00.000 --> 00:00:06.000\none two three");
    expect(body).toContain("00:00:06.000 --> 00:00:08.000\nfour");
  });

  it("a single line spans the whole clip (baseline unchanged)", () => {
    const body = decodeURIComponent(vttFromLines(["Hello there"], 8).split(",")[1]!);
    expect(body).toContain("00:00:00.000 --> 00:00:08.000\nHello there");
  });

  it("ignores empty lines and clamps duration to a sane minimum", () => {
    const body = decodeURIComponent(vttFromLines(["", "x"], 0).split(",")[1]!);
    expect(body).toContain("00:00:00.000 --> 00:00:01.000\nx");
  });
});

describe("spokenLinesFromPrompt", () => {
  it("returns the spoken lines as an array, markers stripped", () => {
    expect(spokenLinesFromPrompt(PROMPT)).toEqual([
      "Stop scrolling — this changes your mornings.",
      "One scoop, ten seconds, done.",
    ]);
  });

  it("returns null when the prompt has no Dialogue section", () => {
    expect(spokenLinesFromPrompt("free-form prompt")).toBeNull();
  });
});
