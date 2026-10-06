import { describe, expect, it } from "vitest";

import {
  buildChatPrompt,
  checkProposal,
  diffLines,
  parseJsonAnswer,
  proposalJsonSchema,
  wordBudget,
} from "~/modules/chat";
import type { DraftLine } from "~/modules/script";

const line = (
  text: string,
  role: DraftLine["role"] = "body",
  emotion: DraftLine["emotion"] = "neutral",
): DraftLine => ({ role, text, emotion });

describe("word budget", () => {
  it("is the clip length times the speaking rate, rounded down", () => {
    expect(wordBudget(8, 2.5)).toBe(20);
    expect(wordBudget(6, 2.2)).toBe(13);
    expect(wordBudget(1, 0.1)).toBe(1);
  });

  it("is stated in the prompt with the clip length", () => {
    const [system] = buildChatPrompt({
      project: { title: "Coffee", platform: "tiktok", format: "9:16", language: "fr" },
      actor: null,
      script: null,
      actors: [{ id: "a", name: "Léa", gender: "female", ageRange: "25-34" }],
      durationS: 12,
      wordsPerSecond: 2.5,
      instructions: "",
      history: [],
      message: "Write it",
    });
    expect(system!.content).toContain("The clip lasts 12 seconds, so the whole script must stay within 30 words.");
    expect(system!.content).toContain("spoken in French");
    expect(system!.content).toContain("Léa (f, 25-34)");
    expect(system!.content).toContain("(no script yet: write the first one)");
    expect(system!.content).not.toContain("House style");
  });

  it("keeps a bounded history that starts on the user's turn", () => {
    const history = Array.from({ length: 9 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `turn ${i}`,
    }));
    const turns = buildChatPrompt({
      project: { title: "t", platform: "tiktok", format: "9:16", language: "en" },
      actor: null,
      script: null,
      actors: [],
      durationS: 8,
      wordsPerSecond: 2.5,
      instructions: "",
      history,
      message: "now",
    });
    expect(turns.map((t) => t.role)).toEqual(["system", "user", "assistant", "user", "assistant", "user", "user"]);
    expect(turns[1]!.content).toBe("turn 4");
    const two = buildChatPrompt({
      project: { title: "t", platform: "tiktok", format: "9:16", language: "en" },
      actor: null,
      script: null,
      actors: [],
      durationS: 8,
      wordsPerSecond: 2.5,
      instructions: "",
      history,
      message: "now",
      historyTurns: 2,
    });
    expect(two.map((t) => t.content)).toEqual([two[0]!.content, "turn 8", "now"]);
    expect(
      buildChatPrompt({
        project: { title: "t", platform: "tiktok", format: "9:16", language: "en" },
        actor: null,
        script: null,
        actors: [],
        durationS: 8,
        wordsPerSecond: 2.5,
        instructions: "",
        history,
        message: "now",
        historyTurns: 0,
      }),
    ).toHaveLength(2);
  });
});

describe("reading the model's answer", () => {
  const context = {
    actors: [{ id: "11111111-1111-4111-8111-111111111111", name: "Léa", gender: "female", ageRange: "25-34" }],
    currentActorId: null,
    budgetWords: 20,
  };

  it("tolerates a code fence or prose around the JSON object", () => {
    expect(parseJsonAnswer('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(parseJsonAnswer('Here you go: {"a": 1} Enjoy!')).toEqual({ a: 1 });
    expect(parseJsonAnswer("no json here")).toBeNull();
  });

  it("names the first problem with where it is", () => {
    const check = checkProposal(
      { summary: "x", lines: [{ role: "intro", text: "Hi", emotion: "neutral" }], actor: null },
      context,
    );
    expect(check).toEqual({ ok: false, problem: expect.stringMatching(/lines\.0\.role/) });
  });

  it("matches an actor's name without case and squeezes spaces in the lines", () => {
    const check = checkProposal(
      { summary: "New actor", lines: [{ role: "hook", text: "  Hello   there ", emotion: "happy" }], actor: "léa" },
      context,
    );
    expect(check).toEqual({
      ok: true,
      overBudget: false,
      proposal: { summary: "New actor", lines: [line("Hello there", "hook", "happy")], actorId: context.actors[0]!.id },
    });
  });

  it("keeps the lines as plain spoken text, without Markdown", () => {
    const check = checkProposal(
      {
        summary: "Bolder",
        lines: [
          { role: "hook", text: "This coffee is **amazing**!", emotion: "excited" },
          { role: "cta", text: "- `Buy` it *now*", emotion: "happy" },
        ],
        actor: null,
      },
      context,
    );
    expect(check.ok && check.proposal.lines.map((l) => l.text)).toEqual(["This coffee is amazing!", "Buy it now"]);
    expect(
      checkProposal({ summary: "x", lines: [{ role: "hook", text: "**", emotion: "neutral" }], actor: null }, context),
    ).toEqual({ ok: false, problem: "a line has no words to say" });
    // The prompt's own notation, copied back by a small model.
    const tagged = checkProposal(
      {
        summary: "x",
        lines: [
          { role: "hook", text: "[hook, very excited] Get your hands on it [body, calm]", emotion: "excited" },
          { role: "cta", text: "Two [sic] cups.", emotion: "happy" },
        ],
        actor: null,
      },
      context,
    );
    expect(tagged.ok && tagged.proposal.lines.map((l) => l.text)).toEqual(["Get your hands on it", "Two [sic] cups."]);
  });

  it("drops emoji, which the voice cannot say", () => {
    const check = checkProposal(
      {
        summary: "Warmer",
        lines: [
          { role: "hook", text: "Grab a cold brew today! ☕", emotion: "happy" },
          { role: "cta", text: "Warm up 🥂 with us 👋🏽 ❤️", emotion: "happy" },
        ],
        actor: null,
      },
      context,
    );
    expect(check.ok && check.proposal.lines.map((l) => l.text)).toEqual(["Grab a cold brew today!", "Warm up with us"]);
    expect(
      checkProposal(
        { summary: "x", lines: [{ role: "hook", text: "🔥🔥", emotion: "neutral" }], actor: null },
        context,
      ),
    ).toEqual({ ok: false, problem: "a line has no words to say" });
    // Flags, keycaps and tag-sequence flags go whole; a zero-width joiner
    // inside a word (Hindi's क्‍ष) stays.
    expect(
      checkProposal(
        {
          summary: "x",
          lines: [
            {
              role: "hook",
              text: "Bonjour 🇫🇷 tout le monde 1️⃣ 🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F} 👩‍💻 fin",
              emotion: "happy",
            },
            { role: "cta", text: "क्\u200dष नमस्ते", emotion: "happy" },
          ],
          actor: null,
        },
        context,
      ),
    ).toMatchObject({ proposal: { lines: [{ text: "Bonjour tout le monde fin" }, { text: "क्\u200dष नमस्ते" }] } });
    // Trademark signs belong to names and stay; ticks and hearts are not said.
    expect(
      checkProposal(
        {
          summary: "x",
          lines: [{ role: "hook", text: "Troupe™ and Acme® ©2026 ✔ ♥ done ✔️", emotion: "happy" }],
          actor: null,
        },
        context,
      ),
    ).toMatchObject({ proposal: { lines: [{ text: "Troupe™ and Acme® ©2026 done" }] } });
    // Digits, symbols and accents are words the voice says.
    expect(
      checkProposal(
        { summary: "x", lines: [{ role: "hook", text: "Café #1: 2 × 50 % off", emotion: "neutral" }], actor: null },
        context,
      ),
    ).toMatchObject({ proposal: { lines: [{ text: "Café #1: 2 × 50 % off" }] } });
  });

  it("offers only the available actors, or none at all", () => {
    expect(proposalJsonSchema(["Léa"]).properties.actor).toEqual({
      anyOf: [{ type: "string", enum: ["Léa"] }, { type: "null" }],
    });
    expect(proposalJsonSchema([]).properties.actor).toEqual({ type: "null" });
  });
});

describe("the diff against the current version", () => {
  it("marks unchanged, retagged, rewritten, added and removed lines in reading order", () => {
    const current = [
      line("Stop scrolling.", "hook"),
      line("Our beans are fresh."),
      line("Free shipping."),
      line("Buy now.", "cta"),
    ];
    const proposed = [
      line("Stop scrolling.", "hook", "excited"),
      line("Roasted this week, shipped today."),
      line("Buy now.", "cta"),
      line("Link in bio.", "cta"),
    ];
    expect(diffLines(current, proposed).map((c) => c.kind)).toEqual(["changed", "changed", "removed", "same", "added"]);
    const rewritten = diffLines(current, proposed)[1]!;
    expect(rewritten).toEqual({ kind: "changed", before: current[1], after: proposed[1] });
  });

  it("is all additions for a first script", () => {
    expect(diffLines([], [line("a"), line("b")]).map((c) => c.kind)).toEqual(["added", "added"]);
  });
});
