import { describe, expect, it } from "vitest";

import { cleanTags, completeItems, readChatAnswer, readIdeas, readInsights, shortenIdea } from "./prompts";

describe("readInsights", () => {
  const answer = (starts: (number | null)[]) => ({
    summary: "S.",
    hook_why: "W.",
    structure: starts.map((s, i) => ({ part: i === 0 ? "hook" : "body", start_s: s, summary: `Part ${i}` })),
    tone: ["Calm"],
    tags: ["#Coffee", "coffee", "Cold Brew"],
  });

  it("keeps plausible times and cleans tone and tags", () => {
    expect(readInsights(answer([0, 4, 12]), 20)).toEqual({
      summary: "S.",
      hookWhy: "W.",
      structure: [
        { part: "hook", startS: 0, summary: "Part 0" },
        { part: "body", startS: 4, summary: "Part 1" },
        { part: "body", startS: 12, summary: "Part 2" },
      ],
      tone: ["calm"],
      tags: ["coffee", "cold brew"],
    });
  });

  it("drops times past the end, and times crammed into the start of a long video", () => {
    expect(readInsights(answer([0, 30]), 20)!.structure[1]).toEqual({ part: "body", summary: "Part 1" });
    expect(readInsights(answer([0, 1, 3, 12]), 888)!.structure.every((p) => p.startS === undefined)).toBe(true);
    expect(readInsights(answer([0, 120, 600]), 888)!.structure.map((p) => p.startS)).toEqual([0, 120, 600]);
  });

  it("refuses an answer without a summary", () => {
    expect(readInsights({ structure: [] }, 10)).toBeNull();
  });
});

describe("cleanTags", () => {
  it("lowercases, drops hashes and repeats, keeps six", () => {
    expect(cleanTags(["#A", "a", " B  c ", "d", "e", "f", "g", "h"])).toEqual(["a", "b c", "d", "e", "f", "g"]);
  });
});

describe("readChatAnswer", () => {
  it("keeps the citations that exist, from the list and the text", () => {
    expect(readChatAnswer({ answer: "It opens on a dare [2], like [9].", sources: [1, 2, 7] }, [1, 2, 3])).toEqual({
      answer: "It opens on a dare [2], like [9].",
      cited: [1, 2],
    });
    expect(readChatAnswer({ sources: [] }, [1])).toBeNull();
  });
});

describe("readIdeas", () => {
  it("makes the first line the hook and the last the call to action, and strips Markdown", () => {
    const [idea] = readIdeas(
      {
        ideas: [
          {
            title: "T",
            hook: "",
            lines: [
              { role: "body", text: "**Bold** start", emotion: "excited" },
              { role: "hook", text: "Middle", emotion: "calm" },
              { role: "body", text: "End", emotion: "happy" },
            ],
          },
        ],
      },
      5,
    );
    expect(idea).toEqual({
      title: "T",
      hook: "Bold start",
      lines: [
        { role: "hook", text: "Bold start", emotion: "excited" },
        { role: "body", text: "Middle", emotion: "calm" },
        { role: "cta", text: "End", emotion: "happy" },
      ],
    });
  });

  it("keeps at most the number asked for, and nothing from an answer that is not ideas", () => {
    const one = { title: "T", hook: "H", lines: [{ role: "hook", text: "H", emotion: "neutral" }] };
    expect(readIdeas({ ideas: [one, one, one] }, 2)).toHaveLength(2);
    expect(readIdeas({ summary: "x" }, 2)).toEqual([]);
    // A malformed idea is dropped, not the whole answer.
    expect(readIdeas({ ideas: [{ title: "", lines: [] }, one] }, 2)).toHaveLength(1);
  });
});

describe("completeItems", () => {
  it("keeps the complete objects of a list cut off mid-way", () => {
    const cut =
      '{"ideas": [{"title": "A", "lines": [{"text": "x {not a brace}"}]}, {"title": "B \\"quoted\\"", "lines": []}, {"title": "C", "lines": [{"te';
    expect(completeItems(cut, "ideas")).toEqual({
      ideas: [
        { title: "A", lines: [{ text: "x {not a brace}" }] },
        { title: 'B "quoted"', lines: [] },
      ],
    });
  });

  it("finds nothing without the list or a complete item", () => {
    expect(completeItems('{"other": []}', "ideas")).toBeNull();
    expect(completeItems('{"ideas": [{"title": "A"', "ideas")).toBeNull();
  });
});

describe("shortenIdea", () => {
  const line = (role: "hook" | "body" | "cta", words: number) => ({
    role,
    text: Array.from({ length: words }, (_, i) => `w${i}`).join(" "),
    emotion: "neutral" as const,
  });
  const idea = { title: "T", hook: "H", lines: [line("hook", 5), line("body", 10), line("body", 10), line("cta", 5)] };

  it("drops body lines from the last until the idea fits, keeping hook and call to action", () => {
    expect(shortenIdea(idea, 30)!.lines).toEqual(idea.lines);
    expect(shortenIdea(idea, 20)!.lines).toEqual([idea.lines[0], idea.lines[1], idea.lines[3]]);
    expect(shortenIdea(idea, 10)!.lines).toEqual([idea.lines[0], idea.lines[3]]);
  });

  it("gives up when the hook and the call to action alone are too long", () => {
    expect(shortenIdea(idea, 9)).toBeNull();
  });
});
