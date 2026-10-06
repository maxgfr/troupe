import { describe, expect, it } from "vitest";

import {
  chunkText,
  chunkTranscript,
  cosine,
  formatTimestamp,
  hookFromText,
  hookFromTranscript,
  keywordScore,
  keywordTags,
  pacingOf,
  rankByCosine,
  styleProfile,
} from "./text";

const seg = (startS: number, endS: number, text: string) => ({ startS, endS, text });

describe("chunkTranscript", () => {
  it("groups segments into passages that keep their times", () => {
    const segments = [
      seg(0, 2, "Stop scrolling."),
      seg(2, 5, "Here is the trick."),
      seg(5, 40, "a ".repeat(300).trim()),
      seg(40, 44, "Follow for more."),
    ];
    const chunks = chunkTranscript(segments, { maxChars: 120, maxSpanS: 30 });
    expect(chunks[0]).toEqual({ text: "Stop scrolling. Here is the trick.", startS: 0, endS: 5 });
    expect(chunks.at(-1)).toEqual({ text: "Follow for more.", startS: 40, endS: 44 });
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(620);
  });

  it("drops empty segments and returns nothing for an empty transcript", () => {
    expect(chunkTranscript([seg(0, 1, "  ")])).toEqual([]);
  });
});

describe("chunkText", () => {
  it("keeps paragraphs together up to the limit and splits long ones on sentences", () => {
    const text = `First idea here.\n\nSecond idea.\n\n${"Long sentence number one. ".repeat(30)}`;
    const chunks = chunkText(text, { maxChars: 200 });
    expect(chunks[0]).toBe("First idea here.\n\nSecond idea.");
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(200);
  });

  it("cuts a sentence with no breaks at the limit", () => {
    const chunks = chunkText("x".repeat(450), { maxChars: 200 });
    expect(chunks.map((c) => c.length)).toEqual([200, 200, 50]);
  });
});

describe("cosine and ranking", () => {
  it("is 1 for the same direction, 0 for orthogonal, 0 for an empty vector", () => {
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(cosine([1, 2, 3], [1, 2])).toBe(0);
  });

  it("ranks by similarity, best first, and keeps the limit", () => {
    const ranked = rankByCosine(
      [1, 0],
      [
        { id: "a", embedding: [0, 1] },
        { id: "b", embedding: [1, 0.1] },
        { id: "c", embedding: [1, 1] },
      ],
      2,
    );
    expect(ranked.map((r) => r.item.id)).toEqual(["b", "c"]);
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });
});

describe("keywordScore", () => {
  it("counts query words, ignoring case and accents", () => {
    expect(keywordScore("Café hooks", "the CAFE uses three hooks, hooks again")).toBeGreaterThan(
      keywordScore("café hooks", "a cafe"),
    );
    expect(keywordScore("nothing", "unrelated text")).toBe(0);
  });
});

describe("hooks", () => {
  it("takes the whole phrases said in the first 3 seconds, and at least the first", () => {
    expect(
      hookFromTranscript([seg(0, 1.5, "Stop."), seg(1.5, 6, "This one trick saves you an hour every day")]),
    ).toEqual({ text: "Stop.", endS: 3 });
    expect(
      hookFromTranscript([seg(0, 1.2, "Stop."), seg(1.2, 2.8, "Look at this."), seg(2.9, 5, "Here is why.")]),
    ).toEqual({ text: "Stop. Look at this.", endS: 3 });
    expect(hookFromTranscript([seg(0.4, 4.5, "Most people brew coffee wrong.")])).toEqual({
      text: "Most people brew coffee wrong.",
      endS: 4.5,
    });
    expect(hookFromTranscript([seg(9, 12, "Late start.")])).toBeNull();
  });

  it("falls back to the first sentence of a text", () => {
    expect(hookFromText("Most people get mornings wrong. Here is why.")).toBe("Most people get mornings wrong.");
    expect(hookFromText("   ")).toBeNull();
    expect(hookFromText("Three hooks that always work:\n\n1. Name the problem.")).toBe("Three hooks that always work:");
  });
});

describe("pacingOf", () => {
  it("measures words per second and cuts per minute", () => {
    const pace = pacingOf({
      segments: [
        seg(
          0,
          10,
          "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five twenty-six twenty-seven twenty-eight twenty-nine thirty",
        ),
      ],
      durationS: 30,
      cutsAtS: [5, 10, 15, 20, 25],
    });
    expect(pace).toEqual({ wordsPerSecond: 3, cutsPerMinute: 10, pace: "fast" });
    expect(pacingOf({ segments: [], durationS: null, cutsAtS: [] })).toBeNull();
    expect(
      pacingOf({
        segments: [
          seg(
            0,
            20,
            "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five twenty-six twenty-seven twenty-eight twenty-nine thirty",
          ),
        ],
        durationS: 20,
        cutsAtS: [],
      })?.pace,
    ).toBe("slow");
  });
});

describe("formatTimestamp", () => {
  it("writes minutes and seconds, hours when needed", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(72.6)).toBe("1:12");
    expect(formatTimestamp(3723)).toBe("1:02:03");
  });
});

describe("keywordTags", () => {
  it("picks the most frequent meaningful words", () => {
    expect(
      keywordTags("Coffee coffee morning routine. The morning coffee, and the routine of the morning.", 3),
    ).toEqual(["coffee", "morning", "routine"]);
  });
});

describe("styleProfile", () => {
  it("is null without items marked as mine", () => {
    expect(styleProfile([])).toBeNull();
  });

  it("sums up hooks, tone, pace and sentence length in a few lines", () => {
    const profile = styleProfile([
      {
        title: "Cold brew",
        hook: "Stop buying coffee.",
        tone: ["playful", "direct"],
        wordsPerSecond: 3.1,
        text: "Stop buying coffee. Make it at home. It takes two minutes.",
      },
      {
        title: "Desk setup",
        hook: "Your desk is lying to you.",
        tone: ["direct"],
        wordsPerSecond: 2.9,
        text: "Your desk is lying to you. Fix the light first.",
      },
    ]);
    expect(profile).toContain("2 of your own pieces");
    expect(profile).toContain('"Stop buying coffee."');
    expect(profile).toContain("direct");
    expect(profile).toContain("3 words a second");
    expect(profile!.length).toBeLessThanOrEqual(600);
  });
});
