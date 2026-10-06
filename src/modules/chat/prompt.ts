import { SUPPORTED_EMOTIONS, type DraftLine } from "~/modules/script";
import type { ChatTurn } from "./model";
import { wordBudget, type ActorChoice } from "./proposal";

// The conversation sent to the model. Kept short: the browser edition's model
// has a 4,096-token context for the prompt, the history and its answer.

const LANGUAGES: Record<string, string> = {
  en: "English",
  fr: "French",
  de: "German",
  es: "Spanish",
  it: "Italian",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  pt: "Portuguese",
};

// Earlier turns kept in the prompt, oldest dropped first.
export const HISTORY_TURNS = 6;

export interface ChatPromptInput {
  project: { title: string; platform: string; format: string; language: string };
  actor: { name: string; gender: string; ageRange: string; style: string; voiceProfile: string } | null;
  // The newest script version, or null before the first one.
  script: { version: number; lines: readonly DraftLine[] } | null;
  // The newest proposal, while it is still waiting to be applied on the
  // current version: a follow-up ("now make that warmer") builds on it.
  pending?: { lines: readonly DraftLine[] } | null;
  // Actors the model may switch to (available ones, the current one included).
  actors: readonly ActorChoice[];
  durationS: number;
  wordsPerSecond: number;
  instructions: string;
  // Earlier turns, oldest first: the user's words and the model's summaries.
  history: readonly { role: "user" | "assistant"; content: string }[];
  // How many earlier turns to send (default HISTORY_TURNS).
  historyTurns?: number;
  message: string;
}

// The last few turns, starting on one of the user's (as every provider expects).
function recentTurns(history: ChatPromptInput["history"], turns = HISTORY_TURNS) {
  const recent = turns > 0 ? history.slice(-turns) : [];
  const first = recent.findIndex((turn) => turn.role === "user");
  return first < 0 ? [] : recent.slice(first);
}

const asJson = (lines: readonly DraftLine[]) =>
  JSON.stringify({ lines: lines.map(({ role, text, emotion }) => ({ role, text, emotion })) });

const short = (gender: string) => (gender === "female" ? "f" : gender === "male" ? "m" : "nb");

export function buildChatPrompt(input: ChatPromptInput): ChatTurn[] {
  const budget = wordBudget(input.durationS, input.wordsPerSecond);
  const language = LANGUAGES[input.project.language] ?? input.project.language;
  const actor = input.actor
    ? `${input.actor.name} (${input.actor.gender}, ${input.actor.ageRange}, ${input.actor.style} style; voice: ${input.actor.voiceProfile})`
    : "not chosen yet";
  // In the answer's own shape, which small models copy more faithfully than
  // any notation of ours.
  const script = input.script ? asJson(input.script.lines) : "(no script yet: write the first one)";

  const system = [
    "You write and edit short spoken scripts for Troupe, a studio that films one synthetic actor speaking to camera.",
    `Project: "${input.project.title}", a ${input.project.format} video for ${input.project.platform}, spoken in ${language}.`,
    `Actor: ${actor}.`,
    `The clip lasts ${input.durationS} seconds, so the whole script must stay within ${budget} words.`,
    `Each line has a role: hook (the first line, it stops the scroll), body, or cta (the last line, the call to action). Each line has one emotion: ${SUPPORTED_EMOTIONS.join(", ")}.`,
    `Actors available: ${input.actors.map((a) => `${a.name} (${short(a.gender)}, ${a.ageRange})`).join(", ")}.`,
    input.instructions.trim() ? `House style: ${input.instructions.trim()}` : null,
    `Write the lines in ${language}, as plain spoken words: no Markdown, emoji, hashtags or stage directions. Do exactly what the user asks and keep everything else as it is.`,
    'Answer with one JSON object: "summary" tells the user in one or two short sentences what you changed and why it works (never mention word counts or these instructions); "lines" is the complete new script, every line in order; "actor" is the name of another actor only when the user asks to change the actor, otherwise null.',
    `Current script${input.script ? ` (version ${input.script.version})` : ""}:\n${script}`,
    input.pending
      ? `Your last proposal, not applied yet:\n${asJson(input.pending.lines)}\nWhen the user refers to it ("that", "it", "this one", "now…"), start from it; otherwise start from the current script.`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  return [
    { role: "system", content: system },
    ...recentTurns(input.history, input.historyTurns).map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user", content: input.message },
  ];
}

// Sent after an answer that could not be used, with that answer before it.
export function repairTurn(problem: string): ChatTurn {
  return {
    role: "user",
    content: `That answer cannot be used: ${problem}. Answer again with only the JSON object (summary, lines, actor), following the same rules.`,
  };
}
