import { describe, expect, it } from "vitest";

import { clock, parseChapters } from "./chapters";

const VTT = `WEBVTT

project
00:00:03.000 --> 00:00:08.400
New project: platform, format, actor

chat
00:00:14.250 --> 00:01:02.000
Ask the chat for a punchier hook
`;

describe("video chapters", () => {
  it("reads each cue's id and start, in seconds", () => {
    expect(parseChapters(VTT)).toEqual([
      { id: "project", start: 3, title: "New project: platform, format, actor" },
      { id: "chat", start: 14.25, title: "Ask the chat for a punchier hook" },
    ]);
  });

  it("reads Windows line endings and cues without hours", () => {
    expect(parseChapters("WEBVTT\r\n\r\nplay\r\n01:05.500 --> 01:20.000\r\nThe render\r\n")).toEqual([{ id: "play", start: 65.5, title: "The render" }]);
  });

  it("decodes the character references cue text may carry", () => {
    expect(parseChapters("WEBVTT\n\napply\n00:27.000 --> 00:30.000\nApply &amp; relaunch &lt;now&gt;\n")).toEqual([{ id: "apply", start: 27, title: "Apply & relaunch <now>" }]);
  });

  it("ignores anything that is not a WebVTT file", () => {
    expect(parseChapters("<!doctype html><title>Not found</title>")).toEqual([]);
  });

  it("writes a start as m:ss", () => {
    expect(clock(3)).toBe("0:03");
    expect(clock(65.5)).toBe("1:05");
  });
});
