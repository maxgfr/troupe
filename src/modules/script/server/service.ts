import { and, asc, desc, eq, inArray } from "drizzle-orm";

import type { Db } from "~/server/db/types";
import { projects } from "~/modules/studio/server/schema";
import { scriptLines, scripts } from "./schema";

export const SUPPORTED_EMOTIONS = ["neutral", "excited", "calm", "serious", "happy", "disappointed"] as const;
export type Emotion = (typeof SUPPORTED_EMOTIONS)[number];
export type LineRole = "hook" | "body" | "cta";

export interface DraftLine {
  role: LineRole;
  text: string;
  emotion: Emotion;
}

export interface ScriptWithLines {
  id: string;
  projectId: string;
  version: number;
  origin: "chat" | "pasted";
  estimatedDurationS: number;
  lines: { index: number; role: LineRole; text: string; emotion: Emotion }[];
}

export class ScriptTooLongError extends Error {
  constructor(
    public readonly estimatedS: number,
    public readonly allowedS: number,
  ) {
    super(`This script takes about ${estimatedS}s to say, but the clip is ${allowedS}s. Shorten it or choose a longer clip.`);
    this.name = "ScriptTooLongError";
  }
}

// Word count ÷ 2.5 words/second (whitespace tokenization).
export function estimateDurationS(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(words / 2.5);
}

export function assertScriptFitsClip(script: { estimatedDurationS: number }, input: { clipLengthS: number }): void {
  if (script.estimatedDurationS > input.clipLengthS) {
    throw new ScriptTooLongError(script.estimatedDurationS, input.clipLengthS);
  }
}

function validateLines(lines: DraftLine[]): void {
  for (const line of lines) {
    if (!(SUPPORTED_EMOTIONS as readonly string[]).includes(line.emotion)) {
      throw new Error(`Unsupported emotion "${line.emotion}". Choose one of: ${SUPPORTED_EMOTIONS.join(", ")}.`);
    }
  }
}

async function nextVersion(db: Db, projectId: string): Promise<number> {
  const [latest] = await db.select({ version: scripts.version }).from(scripts).where(eq(scripts.projectId, projectId)).orderBy(desc(scripts.version)).limit(1);
  return (latest?.version ?? 0) + 1;
}

async function insertScript(db: Db, input: { projectId: string; origin: "chat" | "pasted"; lines: DraftLine[] }): Promise<ScriptWithLines> {
  validateLines(input.lines);
  const estimated = estimateDurationS(input.lines.map((l) => l.text).join(" "));
  return db.transaction(async (tx) => {
    // Serialize version allocation even when saves arrive from multiple tabs.
    const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, input.projectId)).for("update");
    if (!project) throw new Error(`project ${input.projectId} not found`);
    const version = await nextVersion(tx as unknown as Db, input.projectId);
    const [script] = await tx
      .insert(scripts)
      .values({ projectId: input.projectId, version, origin: input.origin, estimatedDurationS: estimated })
      .returning();
    if (!script) throw new Error("script insert returned no row");
    const lines = await tx
      .insert(scriptLines)
      .values(input.lines.map((l, index) => ({ scriptId: script.id, index, role: l.role, text: l.text, emotion: l.emotion })))
      .returning();
    return {
      id: script.id,
      projectId: script.projectId,
      version: script.version,
      origin: script.origin,
      estimatedDurationS: script.estimatedDurationS,
      lines: lines.sort((a, b) => a.index - b.index).map((l) => ({ index: l.index, role: l.role, text: l.text, emotion: l.emotion })),
    };
  });
}

// Pasted scripts split into lines with a neutral default emotion.
export async function pasteScript(db: Db, input: { projectId: string; text: string }): Promise<ScriptWithLines> {
  const raw = input.text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (raw.length === 0) throw new Error("The script is empty. Write at least one line.");
  // Lines whose text did not change keep the emotion chosen for them.
  const [latest] = await db.select({ id: scripts.id }).from(scripts).where(eq(scripts.projectId, input.projectId)).orderBy(desc(scripts.version)).limit(1);
  const previous = latest ? (await loadScript(db, latest.id)).lines : [];
  const used = new Set<number>();
  const lines: DraftLine[] = raw.map((text, i) => {
    const match = previous.find((p) => p.text === text && !used.has(p.index));
    if (match) used.add(match.index);
    return {
      text,
      role: i === 0 ? "hook" : i === raw.length - 1 && raw.length > 1 ? "cta" : "body",
      emotion: match?.emotion ?? "neutral",
    };
  });
  return insertScript(db, { projectId: input.projectId, origin: "pasted", lines });
}

// A whole script written elsewhere (the chat's proposals): every line keeps
// the role and emotion it was given.
export async function saveScriptLines(db: Db, input: { projectId: string; origin: "chat" | "pasted"; lines: DraftLine[] }): Promise<ScriptWithLines> {
  if (input.lines.length === 0) throw new Error("The script is empty. Write at least one line.");
  return insertScript(db, input);
}

// Bring an older version back as the newest one; history stays intact.
export async function restoreScriptVersion(db: Db, scriptId: string): Promise<ScriptWithLines> {
  const old = await loadScript(db, scriptId);
  return insertScript(db, { projectId: old.projectId, origin: old.origin, lines: old.lines.map(({ role, text, emotion }) => ({ role, text, emotion })) });
}

export async function getScript(db: Db, scriptId: string): Promise<ScriptWithLines> {
  return loadScript(db, scriptId);
}

async function loadScript(db: Db, scriptId: string): Promise<ScriptWithLines> {
  const [script] = await db.select().from(scripts).where(eq(scripts.id, scriptId)).limit(1);
  if (!script) throw new Error(`script ${scriptId} not found`);
  const lines = await db.select().from(scriptLines).where(eq(scriptLines.scriptId, scriptId)).orderBy(asc(scriptLines.index));
  return {
    id: script.id,
    projectId: script.projectId,
    version: script.version,
    origin: script.origin,
    estimatedDurationS: script.estimatedDurationS,
    lines: lines.map((l) => ({ index: l.index, role: l.role, text: l.text, emotion: l.emotion })),
  };
}

// Retagging appends a new version. `amend` retags the version in place
// instead: for the newest version while nothing (a render, the chat) refers
// to it yet, so trying emotions does not pile up versions. The caller decides.
export async function setLineEmotion(db: Db, input: { scriptId: string; lineIndex: number; emotion: Emotion; amend?: boolean }): Promise<ScriptWithLines> {
  const current = await loadScript(db, input.scriptId);
  const target = current.lines.find((l) => l.index === input.lineIndex);
  if (!target) throw new Error(`line ${input.lineIndex} not found on script ${input.scriptId}`);
  if (input.amend) {
    validateLines([{ role: target.role, text: target.text, emotion: input.emotion }]);
    await db.update(scriptLines).set({ emotion: input.emotion }).where(and(eq(scriptLines.scriptId, input.scriptId), eq(scriptLines.index, input.lineIndex)));
    return loadScript(db, input.scriptId);
  }
  const lines: DraftLine[] = current.lines.map((l) => ({
    role: l.role,
    text: l.text,
    emotion: l.index === input.lineIndex ? input.emotion : l.emotion,
  }));
  return insertScript(db, { projectId: current.projectId, origin: current.origin, lines });
}

export async function getScriptHistory(db: Db, projectId: string): Promise<ScriptWithLines[]> {
  const rows = await db.select().from(scripts).where(eq(scripts.projectId, projectId)).orderBy(asc(scripts.version));
  if (rows.length === 0) return [];
  const lines = await db.select().from(scriptLines).where(inArray(scriptLines.scriptId, rows.map((r) => r.id))).orderBy(asc(scriptLines.index));
  const byScript = new Map<string, ScriptWithLines["lines"]>();
  for (const line of lines) {
    const group = byScript.get(line.scriptId) ?? [];
    group.push({ index: line.index, role: line.role, text: line.text, emotion: line.emotion });
    byScript.set(line.scriptId, group);
  }
  return rows.map((row) => ({ ...row, lines: byScript.get(row.id) ?? [] }));
}
