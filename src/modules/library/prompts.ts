import { z } from "zod";

import { LINE_ROLES, spoken, type ChatTurn } from "~/modules/chat";
import { SUPPORTED_EMOTIONS, type DraftLine, type Emotion } from "~/modules/script";
import type { ItemKind, StructurePart } from "./model";
import { formatTimestamp } from "./text";

// What the library asks the writing model (the script chat's model: Ollama,
// Claude or the browser's WebLLM) and how it reads the answers. Schemas use
// only what every provider's constrained decoding understands (objects with
// additionalProperties false, required, enum, anyOf and arrays); zod checks
// lengths and counts afterwards.

const LANGUAGES: Record<string, string> = { en: "English", fr: "French", de: "German", es: "Spanish", it: "Italian", zh: "Chinese", ja: "Japanese", ko: "Korean", pt: "Portuguese" };
export const languageName = (code: string | null | undefined) => (code ? (LANGUAGES[code] ?? code) : "the language of the source");

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// --- Analysis -------------------------------------------------------------

export interface InsightInput {
  kind: ItemKind;
  title: string;
  durationS: number | null;
  language: string | null;
  // "[0:03] words" lines, or the text itself.
  transcript: string;
  frames: { atS: number; description?: string; text?: string }[];
  hook: string | null;
}

export function insightSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary", "hook_why", "structure", "tone", "tags"],
    properties: {
      summary: { type: "string", description: "Two sentences: what it is about and how it is made." },
      hook_why: { type: "string", description: "One sentence: why the opening stops the scroll, or why it does not." },
      structure: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["part", "start_s", "summary"],
          properties: {
            part: { type: "string", enum: ["hook", "body", "cta"] },
            start_s: { anyOf: [{ type: "number" }, { type: "null" }] },
            summary: { type: "string" },
          },
        },
      },
      tone: { type: "array", items: { type: "string" } },
      tags: { type: "array", items: { type: "string" } },
    },
  } as const;
}

// The budget of the prompt: the browser's model reads 4,096 tokens in all.
export const INSIGHT_SOURCE_CHARS = 6000;

export function buildInsightPrompt(input: InsightInput): ChatTurn[] {
  const frames = input.frames
    .filter((f) => f.description || f.text)
    .slice(0, 12)
    .map((f) => `[${formatTimestamp(f.atS)}] ${[f.description, f.text ? `on screen: "${f.text}"` : null].filter(Boolean).join("; ")}`)
    .join("\n");
  const system = [
    "You study short-form content (TikTok, Reels, Shorts, posts, articles) for a creator who saved it for inspiration.",
    "Describe how it is made, not whether you like it. Be concrete and brief.",
    `Answer with one JSON object: "summary" (two sentences), "hook_why" (one sentence on the opening), "structure" (the hook, the body parts and the call to action if there is one, in order, each with its start in seconds or null and one short sentence), "tone" (two to four adjectives) and "tags" (three to six lowercase topic tags, one or two words each). Write in ${languageName(input.language)}.`,
  ].join("\n");
  const user = [
    `A ${input.kind}${input.durationS ? ` of ${Math.round(input.durationS)} seconds` : ""}: "${input.title}".`,
    input.hook ? `It opens with: "${input.hook}"` : null,
    input.transcript ? `${input.kind === "video" || input.kind === "audio" ? "Transcript" : "Text"}:\n${clip(input.transcript, INSIGHT_SOURCE_CHARS)}` : "(no words)",
    frames ? `What the pictures show:\n${frames}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

const Insight = z.object({
  summary: z.string().trim().min(1).max(1200),
  hook_why: z.string().trim().max(600).default(""),
  structure: z
    .array(z.object({ part: z.enum(["hook", "body", "cta"]), start_s: z.number().min(0).nullable(), summary: z.string().trim().min(1).max(400) }))
    .max(12)
    .default([]),
  tone: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
});

export interface Insights {
  summary: string;
  hookWhy: string;
  structure: StructurePart[];
  tone: string[];
  tags: string[];
}

// Tags as the library stores them: lowercase, without "#", at most six.
export function cleanTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.toLowerCase().replace(/^#+/, "").replace(/\s+/g, " ").trim();
    if (tag && tag.length <= 40 && !out.includes(tag)) out.push(tag);
  }
  return out.slice(0, 6);
}

export function readInsights(raw: unknown, durationS: number | null): Insights | null {
  const parsed = Insight.safeParse(raw);
  if (!parsed.success) return null;
  const a = parsed.data;
  const inside = (s: number | null) => (s === null || durationS === null || s <= durationS ? s : null);
  return {
    summary: a.summary,
    hookWhy: a.hook_why,
    structure: a.structure.map((p) => {
      const startS = inside(p.start_s);
      return { part: p.part, summary: p.summary, ...(startS !== null ? { startS } : {}) };
    }),
    tone: a.tone.map((t) => t.toLowerCase()).slice(0, 4),
    tags: cleanTags(a.tags),
  };
}

// --- Library chat ---------------------------------------------------------

export interface Source {
  n: number;
  title: string;
  kind: ItemKind;
  startS: number | null;
  text: string;
}

export function chatAnswerSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["answer", "sources"],
    properties: {
      answer: { type: "string", description: "The answer, citing passages as [1], [2]." },
      sources: { type: "array", items: { type: "number" }, description: "The numbers of the passages the answer uses." },
    },
  } as const;
}

export const CHAT_SOURCE_CHARS = 5000;

export function buildLibraryChatPrompt(input: {
  scope: { kind: "library" } | { kind: "item"; title: string };
  sources: readonly Source[];
  voice: string | null;
  history: readonly { role: "user" | "assistant"; content: string }[];
  message: string;
}): ChatTurn[] {
  let budget = CHAT_SOURCE_CHARS;
  const passages: string[] = [];
  for (const s of input.sources) {
    const where = s.startS !== null ? ` at ${formatTimestamp(s.startS)}` : "";
    const line = `[${s.n}] "${s.title}" (${s.kind}${where}): ${s.text}`;
    if (line.length > budget) break;
    budget -= line.length;
    passages.push(line);
  }
  const system = [
    input.scope.kind === "item"
      ? `You help a creator learn from one piece they saved: "${input.scope.title}".`
      : "You help a creator learn from the library of videos, posts and articles they saved for inspiration.",
    "Answer from the passages below only. Cite each passage you use with its number in brackets, like [2]. If the passages do not answer the question, say so in one sentence.",
    "Keep answers short and practical: hooks, structures, phrasings, ideas they can reuse.",
    input.voice ? `The creator's own style, for anything you write for them: ${input.voice}` : null,
    'Answer with one JSON object: "answer" (plain text, no Markdown headings) and "sources" (the numbers you cited).',
    passages.length ? `Passages:\n${passages.join("\n")}` : "Passages: none match this question.",
  ]
    .filter(Boolean)
    .join("\n");
  const recent = input.history.slice(-4);
  const first = recent.findIndex((t) => t.role === "user");
  return [
    { role: "system", content: system },
    ...(first < 0 ? [] : recent.slice(first)).map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: input.message },
  ];
}

const ChatAnswer = z.object({ answer: z.string().trim().min(1).max(4000), sources: z.array(z.number()).max(20).default([]) });

// The answer and the passages it cites: those listed, and any [n] in the text.
export function readChatAnswer(raw: unknown, known: readonly number[]): { answer: string; cited: number[] } | null {
  const parsed = ChatAnswer.safeParse(raw);
  if (!parsed.success) return null;
  const inText = [...parsed.data.answer.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1]));
  const cited = [...new Set([...inText, ...parsed.data.sources.map(Math.round)])].filter((n) => known.includes(n)).sort((a, b) => a - b);
  return { answer: parsed.data.answer, cited };
}

// --- Ideas ----------------------------------------------------------------

export const IDEA_KINDS = ["ideas", "remix", "script", "repurpose"] as const;
export type IdeaKind = (typeof IDEA_KINDS)[number];

export function ideasSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["ideas"],
    properties: {
      ideas: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "hook", "lines"],
          properties: {
            title: { type: "string", description: "A working title, a few words." },
            hook: { type: "string", description: "The opening line, which stops the scroll." },
            lines: {
              type: "array",
              description: "The whole script, the hook first and the call to action last.",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["role", "text", "emotion"],
                properties: {
                  role: { type: "string", enum: [...LINE_ROLES] },
                  text: { type: "string" },
                  emotion: { type: "string", enum: [...SUPPORTED_EMOTIONS] },
                },
              },
            },
          },
        },
      },
    },
  } as const;
}

export interface IdeaSource {
  title: string;
  kind: ItemKind;
  hook: string | null;
  summary: string | null;
  structure: string | null;
  tone: readonly string[];
  // The words, shortened.
  excerpt: string;
}

export interface IdeaRequest {
  kind: IdeaKind;
  count: number;
  sources: readonly IdeaSource[];
  // Seconds each script must fit, and the speaking rate.
  durationS: number;
  wordsPerSecond: number;
  language: string;
  actor: { name: string; gender: string; ageRange: string; style: string; voiceProfile: string } | null;
  voice: string | null;
  // The user's own words ("about our spring jacket").
  brief: string | null;
}

export const IDEA_SOURCE_CHARS = 4500;

const ASKS: Record<IdeaKind, (n: number) => string> = {
  ideas: (n) => `Write ${n} new video ideas in the style of the source${n === 1 ? "" : "s"}: the same kind of hook, structure, pacing and tone, on new subjects. Do not copy their words.`,
  remix: (n) => `Write ${n} remixes of the source's hook: ${n} different openings that work the way it does (same mechanism, new words), each followed by a short script that delivers on it.`,
  script: () => "Turn the source into one script for the actor below to say to camera: keep what makes it work, in new words.",
  repurpose: (n) => `Cut the source into ${n} separate short scripts, each built around a different moment or point of it, each standing on its own.`,
};

export function buildIdeasPrompt(input: IdeaRequest): ChatTurn[] {
  const budget = Math.max(8, Math.floor(input.durationS * input.wordsPerSecond));
  let room = IDEA_SOURCE_CHARS;
  const sources: string[] = [];
  input.sources.forEach((s, i) => {
    const block = [
      `Source ${i + 1}: "${s.title}" (${s.kind})`,
      s.hook ? `Hook: "${s.hook}"` : null,
      s.structure ? `Structure: ${s.structure}` : null,
      s.tone.length ? `Tone: ${s.tone.join(", ")}` : null,
      s.summary ? `About: ${s.summary}` : null,
      s.excerpt ? `Words: ${s.excerpt}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    const cut = clip(block, Math.max(200, room));
    room -= cut.length;
    if (room > -200) sources.push(cut);
  });
  const actor = input.actor
    ? `The actor: ${input.actor.name} (${input.actor.gender}, ${input.actor.ageRange}, ${input.actor.style} style; voice: ${input.actor.voiceProfile}).`
    : null;
  const system = [
    "You write short spoken scripts for Troupe, a studio that films one synthetic actor speaking to camera.",
    ASKS[input.kind](input.count),
    `Each script lasts about ${input.durationS} seconds: at most ${budget} words in all, in two to six lines. The first line is the hook (role "hook"), the last the call to action (role "cta"), the others "body". Each line has one emotion: ${SUPPORTED_EMOTIONS.join(", ")}.`,
    `Write in ${languageName(input.language)}, as plain spoken words: no Markdown, emoji, hashtags or stage directions.`,
    actor,
    input.voice ? `Write in the creator's own voice: ${input.voice}` : null,
    `Answer with one JSON object: "ideas", a list of exactly ${input.count} item${input.count === 1 ? "" : "s"}, each with "title", "hook" and "lines".`,
  ]
    .filter(Boolean)
    .join("\n");
  const user = [input.brief ? `What I want: ${input.brief}` : null, sources.join("\n\n")].filter(Boolean).join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user || "(no source: write from the instructions)" },
  ];
}

const IdeaLine = z.object({ role: z.enum(LINE_ROLES), text: z.string().trim().min(1).max(400), emotion: z.enum(SUPPORTED_EMOTIONS) });
const IdeaAnswer = z.object({
  ideas: z
    .array(z.object({ title: z.string().trim().min(1).max(200), hook: z.string().trim().max(400).default(""), lines: z.array(IdeaLine).min(1).max(12) }))
    .min(1)
    .max(20),
});

export interface WrittenIdea {
  title: string;
  hook: string;
  lines: DraftLine[];
}

// The ideas that can become a script; the others are dropped. The first
// line is always the hook and the last the call to action, whatever the
// model said, as the studio's pasted scripts do.
export function readIdeas(raw: unknown, max: number): WrittenIdea[] {
  const parsed = IdeaAnswer.safeParse(raw);
  if (!parsed.success) return [];
  const out: WrittenIdea[] = [];
  for (const idea of parsed.data.ideas) {
    const lines = idea.lines.map((l) => ({ role: l.role, text: spoken(l.text), emotion: l.emotion as Emotion })).filter((l) => l.text);
    if (lines.length === 0) continue;
    const roled: DraftLine[] = lines.map((l, i) => ({ ...l, role: i === 0 ? "hook" : i === lines.length - 1 && lines.length > 1 ? "cta" : "body" }));
    out.push({ title: idea.title, hook: spoken(idea.hook) || roled[0]!.text, lines: roled });
    if (out.length >= max) break;
  }
  return out;
}
