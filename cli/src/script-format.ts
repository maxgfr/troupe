import type { Inputs, Outputs } from "./client.ts";
import { usageError } from "./errors.ts";

// The script file `troupe script set` reads and `troupe script show --text`
// writes: one spoken line per line, an optional [emotion] in front, and
// `#` comments. Roles follow the order, as when a script is pasted in the
// studio: the first line is the hook, the last the call to action.
//
//   # Spring drop, 8 s
//   [excited] Stop scrolling: this jacket packs into its own pocket.
//   It weighs 180 grams and sheds rain.
//   [calm] Tap the link before Friday.
//
// A JSON file works too: { "lines": [{ "text": "…", "emotion": "calm" }] },
// the shape `troupe script show --json` prints.

export type Emotion = Inputs["script"]["setLineEmotion"]["emotion"];
// What every script call returns (history rows carry a few more columns).
export type Script = Outputs["script"]["paste"];

export const EMOTIONS = [
  "neutral",
  "excited",
  "calm",
  "serious",
  "happy",
  "disappointed",
] as const satisfies readonly Emotion[];
// Fails to compile when the server adds an emotion this list lacks.
const everyEmotion: Record<Exclude<Emotion, (typeof EMOTIONS)[number]>, never> = {};
void everyEmotion;

export interface ScriptLineInput {
  text: string;
  // Absent: the studio keeps the emotion the same text had in the previous
  // version, or neutral.
  emotion?: Emotion;
}

const TAG = /^\[([a-zA-Z]+)\]\s*/;

function asEmotion(value: string, where: string): Emotion {
  const emotion = value.toLowerCase();
  if (!(EMOTIONS as readonly string[]).includes(emotion))
    throw usageError(`${where}: unknown emotion "${value}". Use one of: ${EMOTIONS.join(", ")}.`);
  return emotion as Emotion;
}

function parseJsonScript(text: string): ScriptLineInput[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw usageError(`The script looks like JSON but does not parse: ${(error as Error).message}`);
  }
  const lines = (data as { lines?: unknown })?.lines;
  if (!Array.isArray(lines))
    throw usageError('A JSON script needs a "lines" array: { "lines": [{ "text": "…", "emotion": "calm" }] }.');
  return lines.map((line, i) => {
    const where = `lines[${i}]`;
    const { text, emotion } = (line ?? {}) as { text?: unknown; emotion?: unknown };
    if (typeof text !== "string" || !text.trim()) throw usageError(`${where}: "text" must be a non-empty string.`);
    if (emotion !== undefined && emotion !== null && typeof emotion !== "string")
      throw usageError(`${where}: "emotion" must be a string.`);
    return {
      text: text.replace(/\s+/g, " ").trim(),
      ...(typeof emotion === "string" ? { emotion: asEmotion(emotion, where) } : {}),
    };
  });
}

export function parseScript(input: string): ScriptLineInput[] {
  const text = input.replace(/^﻿/, "");
  if (text.trimStart().startsWith("{")) return checked(parseJsonScript(text));
  const lines: ScriptLineInput[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const tag = TAG.exec(line);
    const spoken = tag ? line.slice(tag[0].length).trim() : line;
    if (!spoken) throw usageError(`Line ${i + 1}: an emotion with nothing to say.`);
    lines.push({ text: spoken, ...(tag ? { emotion: asEmotion(tag[1]!, `Line ${i + 1}`) } : {}) });
  });
  return checked(lines);
}

function checked(lines: ScriptLineInput[]): ScriptLineInput[] {
  if (lines.length === 0) throw usageError("The script is empty. Write at least one line.");
  return lines;
}

// Words ÷ 2.5 per second, rounded up, as the studio estimates
// (estimateDurationS in src/modules/script).
export function estimateSeconds(lines: readonly { text: string }[]): number {
  return Math.ceil(lines.reduce((sum, l) => sum + l.text.split(/\s+/).filter(Boolean).length, 0) / 2.5);
}

export function wordCount(lines: readonly { text: string }[]): number {
  return lines.reduce((sum, l) => sum + l.text.split(/\s+/).filter(Boolean).length, 0);
}

export function formatScript(
  script: Pick<Script, "version" | "origin" | "estimatedDurationS" | "lines">,
  title?: string,
): string {
  const head = `# ${title ? `${title}, ` : ""}version ${script.version} (${script.origin}), about ${script.estimatedDurationS} s to say`;
  return [head, ...script.lines.map((l) => `[${l.emotion}] ${l.text}`)].join("\n");
}
