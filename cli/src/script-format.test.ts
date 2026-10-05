import { describe, expect, it } from "vitest";

import { estimateSeconds, formatScript, parseScript } from "./script-format.ts";

describe("script files", () => {
  it("reads one line each, an optional [emotion] in front, and skips comments and blank lines", () => {
    expect(parseScript("﻿# Spring drop\n\n[Excited]  Stop scrolling.\nIt weighs   180 grams.\r\n[calm] Tap the link.\n")).toEqual([
      { text: "Stop scrolling.", emotion: "excited" },
      { text: "It weighs   180 grams." },
      { text: "Tap the link.", emotion: "calm" },
    ]);
  });

  it("names the line of an unknown emotion or an empty tagged line, and refuses an empty script", () => {
    expect(() => parseScript("Fine.\n[angry] Not this.")).toThrow('Line 2: unknown emotion "angry". Use one of: neutral, excited, calm, serious, happy, disappointed.');
    expect(() => parseScript("[calm]")).toThrow("Line 1: an emotion with nothing to say.");
    expect(() => parseScript("# only a comment\n\n")).toThrow("The script is empty.");
  });

  it("reads the JSON that script show --json prints", () => {
    const shown = { id: "x", version: 3, lines: [{ index: 0, role: "hook", text: " Hello\nthere ", emotion: "happy" }, { index: 1, role: "cta", text: "Bye.", emotion: null }] };
    expect(parseScript(JSON.stringify(shown))).toEqual([{ text: "Hello there", emotion: "happy" }, { text: "Bye." }]);
    expect(() => parseScript('{"lines": [{"text": ""}]}')).toThrow('lines[0]: "text" must be a non-empty string.');
    expect(() => parseScript("{ nope")).toThrow("does not parse");
    expect(() => parseScript('{"text": "a"}')).toThrow('needs a "lines" array');
  });

  it("round-trips through the text format show --text prints", () => {
    const script = { version: 2, origin: "chat" as const, estimatedDurationS: 3, lines: [{ index: 0, role: "hook" as const, text: "Stop scrolling.", emotion: "excited" as const }, { index: 1, role: "cta" as const, text: "Follow.", emotion: "neutral" as const }] };
    const text = formatScript(script, "Spring drop");
    expect(text).toBe("# Spring drop, version 2 (chat), about 3 s to say\n[excited] Stop scrolling.\n[neutral] Follow.");
    expect(parseScript(text)).toEqual([{ text: "Stop scrolling.", emotion: "excited" }, { text: "Follow.", emotion: "neutral" }]);
  });

  it("estimates speaking time as the studio does: words / 2.5, rounded up", () => {
    expect(estimateSeconds([{ text: "one two three four five" }, { text: "six" }])).toBe(3);
    expect(estimateSeconds([{ text: "one two three four five" }])).toBe(2);
  });
});
