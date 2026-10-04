import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import type { Db } from "~/server/db/types";
import { checkLocalUrl } from "~/server/settings/urls";
import { actors, listActors } from "~/modules/actors";
import { studioSettings } from "~/modules/models";
import { getScript, saveScriptLines, scripts, type ScriptWithLines } from "~/modules/script";
import { changeProjectActor, getProject } from "~/modules/studio";
import { ChatProviderError, type ChatAnswer, type ChatSettings, type ChatSetup, type ChatTurn } from "../model";
import { buildChatPrompt, repairTurn } from "../prompt";
import { checkProposal, countWords, proposalJsonSchema, StoredProposal, wordBudget, type ActorChoice, type Proposal, type ProposalCheck } from "../proposal";
import { chatMessages } from "./schema";

export interface ChatMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  // Null for the user's messages, and for an answer that was not a script.
  proposal: Proposal | null;
  baseScriptId: string | null;
  appliedScriptId: string | null;
  provider: string | null;
  model: string | null;
  createdAt: Date;
}

export class ChatMessageNotFoundError extends Error {
  constructor() {
    super("This chat message was not found in this project.");
    this.name = "ChatMessageNotFoundError";
  }
}

export class NothingToApplyError extends Error {
  constructor() {
    super("This message has no script to apply.");
    this.name = "NothingToApplyError";
  }
}

function view(row: typeof chatMessages.$inferSelect): ChatMessageView {
  const parsed = row.proposal ? StoredProposal.safeParse(row.proposal) : null;
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    proposal: parsed?.success ? parsed.data : null,
    baseScriptId: row.baseScriptId,
    appliedScriptId: row.appliedScriptId,
    provider: row.provider,
    model: row.model,
    createdAt: row.createdAt,
  };
}

export async function listChatMessages(db: Db, projectId: string): Promise<ChatMessageView[]> {
  const rows = await db.select().from(chatMessages).where(eq(chatMessages.projectId, projectId)).orderBy(asc(chatMessages.createdAt), asc(chatMessages.role));
  return rows.map(view);
}

async function latestScript(db: Db, projectId: string): Promise<ScriptWithLines | null> {
  const [latest] = await db.select({ id: scripts.id }).from(scripts).where(eq(scripts.projectId, projectId)).orderBy(desc(scripts.version)).limit(1);
  return latest ? getScript(db, latest.id) : null;
}

// The actors the model may name: available ones, one per name.
async function actorChoices(db: Db): Promise<ActorChoice[]> {
  const seen = new Set<string>();
  const out: ActorChoice[] = [];
  for (const actor of await listActors(db, {})) {
    const key = actor.name.toLowerCase();
    if (actor.status !== "active" || seen.has(key)) continue;
    seen.add(key);
    out.push({ id: actor.id, name: actor.name, gender: actor.gender, ageRange: actor.ageRange });
  }
  return out;
}

function describeProblem(check: ProposalCheck, words: number | null, budget: number): string {
  if (!check.ok) return check.problem;
  return `the script has ${words} words but the clip allows ${budget}; shorten the lines`;
}

// One request: the model answers; an answer that is not a script, or that is
// too long for the clip, gets one more try with the problem spelled out.
export async function sendChatMessage(
  db: Db,
  input: { projectId: string; message: string; durationS: number; setup: ChatSetup; signal?: AbortSignal },
): Promise<{ user: ChatMessageView; assistant: ChatMessageView }> {
  const { setup } = input;
  if (!setup.model) throw new ChatProviderError(setup.problem ?? "No chat model is set up. Choose one in Settings.");

  const project = await getProject(db, input.projectId);
  const [actor] = project.actorId ? await db.select().from(actors).where(eq(actors.id, project.actorId)).limit(1) : [];
  const [script, choices, history] = await Promise.all([latestScript(db, input.projectId), actorChoices(db), listChatMessages(db, input.projectId)]);
  const budget = wordBudget(input.durationS, setup.wordsPerSecond);
  const context = { actors: choices, currentActorId: project.actorId, budgetWords: budget };

  // The newest proposal, if it still waits on the version the user has.
  const lastProposal = [...history].reverse().find((m) => m.role === "assistant" && m.proposal);
  const pending = lastProposal?.proposal && !lastProposal.appliedScriptId && lastProposal.baseScriptId === (script?.id ?? null) ? { lines: lastProposal.proposal.lines } : null;

  const messages = buildChatPrompt({
    project,
    pending,
    actor: actor ?? null,
    script: script ? { version: script.version, lines: script.lines } : null,
    actors: choices,
    durationS: input.durationS,
    wordsPerSecond: setup.wordsPerSecond,
    instructions: setup.instructions,
    // An answer that was not a script stays out of the model's memory.
    history: history.filter((m) => m.role === "user" || m.proposal).map((m) => ({ role: m.role, content: m.content })),
    historyTurns: setup.historyTurns,
    message: input.message,
  });
  const schema = proposalJsonSchema(choices.map((a) => a.name));
  const ask = (turns: ChatTurn[]) => setup.model!.propose(turns, { schema, signal: input.signal });
  const check = (answer: ChatAnswer): ProposalCheck =>
    answer.proposal === null ? { ok: false, problem: "it is not a JSON object" } : checkProposal(answer.proposal, context);

  const first = await ask(messages);
  const firstCheck = check(first);
  let outcome: { proposal: Proposal | null; text: string };
  if (firstCheck.ok && !firstCheck.overBudget) {
    outcome = { proposal: firstCheck.proposal, text: first.text };
  } else {
    const words = firstCheck.ok ? countWords(firstCheck.proposal.lines) : null;
    const second = await ask([...messages, { role: "assistant", content: first.text }, repairTurn(describeProblem(firstCheck, words, budget))]);
    const secondCheck = check(second);
    if (secondCheck.ok) outcome = { proposal: secondCheck.proposal, text: second.text };
    // Too long is still a script: the panel shows its length against the clip.
    else if (firstCheck.ok) outcome = { proposal: firstCheck.proposal, text: first.text };
    else outcome = { proposal: null, text: second.text.trim() || first.text.trim() || "(the model sent an empty answer)" };
  }

  // Explicit times: both rows commit together, and the request comes first.
  const askedAt = new Date();
  const answeredAt = new Date(askedAt.getTime() + 1);
  const baseScriptId = script?.id ?? null;
  const [user, assistant] = await db.transaction(async (tx) => {
    const [u] = await tx.insert(chatMessages).values({ projectId: input.projectId, role: "user", content: input.message, baseScriptId, createdAt: askedAt }).returning();
    const [a] = await tx
      .insert(chatMessages)
      .values({
        projectId: input.projectId,
        role: "assistant",
        content: outcome.proposal ? outcome.proposal.summary : outcome.text,
        proposal: outcome.proposal,
        baseScriptId,
        provider: setup.provider,
        model: setup.modelId,
        createdAt: answeredAt,
      })
      .returning();
    return [u!, a!];
  });
  return { user: view(user), assistant: view(assistant) };
}

// Turns a proposal into the project's newest script version (origin "chat"),
// and recasts the project when the proposal names another actor. Applying
// the same message twice returns the version it already made.
export async function applyChatProposal(db: Db, input: { projectId: string; messageId: string }): Promise<{ script: ScriptWithLines; actorChanged: boolean }> {
  return db.transaction(async (tx) => {
    const conn = tx as unknown as Db;
    const [row] = await tx
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.id, input.messageId), eq(chatMessages.projectId, input.projectId)))
      .for("update");
    if (!row) throw new ChatMessageNotFoundError();
    const proposal = row.role === "assistant" && row.proposal ? StoredProposal.safeParse(row.proposal) : null;
    if (!proposal?.success) throw new NothingToApplyError();
    if (row.appliedScriptId) return { script: await getScript(conn, row.appliedScriptId), actorChanged: false };

    const script = await saveScriptLines(conn, { projectId: input.projectId, origin: "chat", lines: proposal.data.lines });
    let actorChanged = false;
    if (proposal.data.actorId) {
      const project = await getProject(conn, input.projectId);
      if (project.actorId !== proposal.data.actorId) {
        await changeProjectActor(conn, { projectId: input.projectId, actorId: proposal.data.actorId });
        actorChanged = true;
      }
    }
    await tx.update(chatMessages).set({ appliedScriptId: script.id }).where(eq(chatMessages.id, row.id));
    return { script, actorChanged };
  });
}

// --- Settings -----------------------------------------------------------

const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

const OllamaUrl = z.string().trim().max(500).superRefine((url, ctx) => {
  const check = checkLocalUrl(url);
  if (!check.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: check.reason });
});

const SETTING_FIELDS = {
  provider: z.enum(["auto", "ollama", "anthropic"]),
  ollamaUrl: OllamaUrl,
  ollamaModel: z.string().trim().min(1).max(200),
  anthropicModel: z.string().trim().min(1).max(200).regex(/^[\w.:@/-]+$/, "Use a model id such as claude-opus-5-5."),
  instructions: z.string().trim().max(2000),
  wordsPerSecond: z.number().min(1).max(5),
} satisfies { [K in keyof ChatSettings]-?: z.ZodType };

type SettingKey = keyof typeof SETTING_FIELDS;
const KEYS = Object.keys(SETTING_FIELDS) as SettingKey[];
const optional = <T extends z.ZodTypeAny>(field: T) => z.preprocess(blankToUndefined, field.nullish());

// A change from Settings: a value sets it, null (or a blank string) brings
// back the default.
export const ChatSettingsPatch = z.object({
  provider: optional(SETTING_FIELDS.provider),
  ollamaUrl: optional(SETTING_FIELDS.ollamaUrl),
  ollamaModel: optional(SETTING_FIELDS.ollamaModel),
  anthropicModel: optional(SETTING_FIELDS.anthropicModel),
  instructions: optional(SETTING_FIELDS.instructions),
  wordsPerSecond: optional(SETTING_FIELDS.wordsPerSecond),
});
export type ChatSettingsPatch = { [K in SettingKey]?: ChatSettings[K] | null };

// Each stored value is checked on its own: one a newer or older version
// wrote differently falls back to its default without losing the others.
export async function getChatSettings(db: Db): Promise<ChatSettings> {
  const [row] = await db.select({ chat: studioSettings.chat }).from(studioSettings).where(eq(studioSettings.id, 1)).limit(1);
  const stored = row?.chat ?? {};
  const out: Record<string, unknown> = {};
  for (const key of KEYS) {
    if (stored[key] === undefined) continue;
    const parsed = SETTING_FIELDS[key].safeParse(stored[key]);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as ChatSettings;
}

export async function saveChatSettings(db: Db, patch: ChatSettingsPatch): Promise<ChatSettings> {
  const parsed = ChatSettingsPatch.parse(patch) as Record<SettingKey, unknown>;
  const next: Record<string, unknown> = { ...(await getChatSettings(db)) };
  for (const key of KEYS) {
    if (!(key in patch)) continue;
    if (parsed[key] === undefined || parsed[key] === null) delete next[key];
    else next[key] = parsed[key];
  }
  await db.insert(studioSettings).values({ id: 1, chat: next }).onConflictDoUpdate({ target: studioSettings.id, set: { chat: next, updatedAt: new Date() } });
  return next as ChatSettings;
}
