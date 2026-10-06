import { z } from "zod";

import { SUPPORTED_EMOTIONS, type DraftLine, type Emotion, type LineRole } from "~/modules/script";

// What the chat model proposes: a short reply, the whole new script, and an
// optional new actor. The model answers under a JSON schema (constrained
// decoding where the provider has it), then zod checks the answer again.

export const LINE_ROLES = ["hook", "body", "cta"] as const satisfies readonly LineRole[];

// Stored with the assistant's message (troupe_chat_message.proposal).
export interface Proposal {
  summary: string;
  lines: DraftLine[];
  // Set only when the model was asked for another actor.
  actorId?: string;
}

// An actor the model may switch to, named as the model sees it.
export interface ActorChoice {
  id: string;
  name: string;
  gender: string;
  ageRange: string;
}

export const MAX_LINES = 20;
const MAX_LINE_CHARS = 400;
const MAX_SUMMARY_CHARS = 600;

// The JSON schema the model answers with. Only features every provider's
// constrained decoding understands: objects with additionalProperties false,
// required, enum, anyOf and arrays (no length or numeric bounds; zod checks
// those). The actor is named, not given by id: small models copy names well.
export function proposalJsonSchema(actorNames: readonly string[]) {
  const actor =
    actorNames.length > 0 ? { anyOf: [{ type: "string", enum: [...actorNames] }, { type: "null" }] } : { type: "null" };
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary", "lines", "actor"],
    properties: {
      summary: { type: "string", description: "One or two sentences telling the user what changed." },
      lines: {
        type: "array",
        description: "The complete new script, every line in order.",
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
      actor,
    },
  } as const;
}

export type ProposalJsonSchema = ReturnType<typeof proposalJsonSchema>;

const ModelLine = z.object({
  role: z.enum(LINE_ROLES),
  text: z
    .string()
    .trim()
    .min(1, "a line is empty")
    .max(MAX_LINE_CHARS, `a line is longer than ${MAX_LINE_CHARS} characters`),
  emotion: z.enum(SUPPORTED_EMOTIONS),
});

const ModelAnswer = z.object({
  summary: z.string().trim().min(1, "the summary is empty").max(MAX_SUMMARY_CHARS),
  lines: z
    .array(ModelLine)
    .min(1, "the script has no lines")
    .max(MAX_LINES, `the script has more than ${MAX_LINES} lines`),
  actor: z.string().nullish(),
});

// The proposal as stored, read back from the database.
export const StoredProposal = z.object({
  summary: z.string(),
  lines: z.array(z.object({ role: z.enum(LINE_ROLES), text: z.string(), emotion: z.enum(SUPPORTED_EMOTIONS) })),
  actorId: z.string().uuid().optional(),
});

// What the actor says, as plain text: small models like to add Markdown
// emphasis, which the voice would read and the captions would show.
// A bracketed role or emotion copied from the prompt ("[hook, excited]") goes
// too.
const TAG = new RegExp(`\\[[^\\]]*\\b(?:${[...LINE_ROLES, ...SUPPORTED_EMOTIONS].join("|")})\\b[^\\]]*\\]`, "gi");

// So do emoji, whole: a pictograph or a regional-indicator letter (two make a
// flag) or a keycap ("1️⃣"), with what rides on it (presentation selector,
// skin tone, the tags of a flag like England's) and the joiner to the next
// pictograph ("👩‍💻"). There is nothing in them to say. A joiner inside a word
// (Hindi's "क्‍ष") is not touched, nor are ©, ® and ™, which belong to the
// names they follow; ✔ and ♥ go.
const EMOJI =
  /(?:[#*0-9]\uFE0F?\u20E3|(?![\u00A9\u00AE\u2122])\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier})(?:\uFE0F|\u20E3|\p{Emoji_Modifier}|[\u{E0020}-\u{E007F}]|\u200D(?=\p{Extended_Pictographic}))*/gu;

export function spoken(text: string): string {
  return (
    text
      .replace(TAG, "")
      .replace(/[*`]+/g, "")
      .replace(EMOJI, "")
      // A presentation selector left on a kept sign ("©️") shows nothing.
      .replace(/\uFE0F/g, "")
      .replace(/^\s*(?:[-•]|#+)\s+/, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function countWords(lines: readonly { text: string }[]): number {
  return lines.reduce((sum, line) => sum + line.text.split(/\s+/).filter(Boolean).length, 0);
}

// Words that fit in a clip, at the chat's speaking rate.
export function wordBudget(durationS: number, wordsPerSecond: number): number {
  return Math.max(1, Math.floor(durationS * wordsPerSecond));
}

export type ProposalCheck = { ok: true; proposal: Proposal; overBudget: boolean } | { ok: false; problem: string };

// Reads the model's answer: valid JSON in the schema, an actor that exists,
// and lines that fit the word budget. Over budget is reported, not refused:
// the repair attempt asks for shorter lines, and if that fails too the user
// still sees the proposal with its length.
export function checkProposal(
  raw: unknown,
  context: { actors: readonly ActorChoice[]; currentActorId: string | null; budgetWords: number },
): ProposalCheck {
  const parsed = ModelAnswer.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const where = issue.path.length ? ` (at ${issue.path.join(".")})` : "";
    return { ok: false, problem: `${issue.message}${where}` };
  }
  const answer = parsed.data;
  let actorId: string | undefined;
  if (answer.actor) {
    const actor = context.actors.find((a) => a.name.toLowerCase() === answer.actor!.trim().toLowerCase());
    if (!actor) return { ok: false, problem: `there is no actor named "${answer.actor}"` };
    if (actor.id !== context.currentActorId) actorId = actor.id;
  }
  const lines: DraftLine[] = answer.lines.map((l) => ({
    role: l.role,
    text: spoken(l.text),
    emotion: l.emotion as Emotion,
  }));
  if (lines.some((l) => !l.text)) return { ok: false, problem: "a line has no words to say" };
  const proposal: Proposal = { summary: answer.summary, lines, ...(actorId ? { actorId } : {}) };
  return { ok: true, proposal, overBudget: countWords(lines) > context.budgetWords };
}

// Parses a model's text answer, tolerating a code fence or prose around the
// object (what an unconstrained model tends to add).
export function parseJsonAnswer(text: string): unknown | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}
