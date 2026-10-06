import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { Db } from "~/server/db/types";
import { listActors } from "~/modules/actors";
import { countWords, parseJsonAnswer } from "~/modules/chat";
import { saveScriptLines } from "~/modules/script";
import { createProjectFromWizard, formatOptionsFor, type Platform } from "~/modules/studio";
import { LibraryError, type ItemAnalysis } from "../model";
import {
  buildIdeasPrompt,
  completeItems,
  ideasSchema,
  readIdeas,
  type IdeaKind,
  type IdeaSource,
  type WrittenIdea,
} from "../prompts";
import { formatTimestamp } from "../text";
import { voiceProfile, type ItemRow } from "./items";
import { libraryIdeas, libraryItems } from "./schema";
import { ask, type Writer } from "./writer";

// Idea cards written from saved items ("10 ideas in this style", a remixed
// hook, a script for one actor, a long item cut into short ones), and the
// project made from one.

export interface IdeaView {
  id: string;
  kind: IdeaKind;
  title: string;
  hook: string;
  lines: typeof libraryIdeas.$inferSelect.lines;
  itemIds: string[];
  actorId: string | null;
  language: string;
  projectId: string | null;
  provider: string | null;
  model: string | null;
  createdAt: Date;
}

const ideaView = (row: typeof libraryIdeas.$inferSelect): IdeaView => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  hook: row.hook,
  lines: row.lines,
  itemIds: row.itemIds,
  actorId: row.actorId,
  language: row.language,
  projectId: row.projectId,
  provider: row.provider,
  model: row.model,
  createdAt: row.createdAt,
});

export async function listIdeas(db: Db, input: { workspaceId: string; itemId?: string }): Promise<IdeaView[]> {
  const rows = await db
    .select()
    .from(libraryIdeas)
    .where(
      and(
        eq(libraryIdeas.workspaceId, input.workspaceId),
        input.itemId ? sql`${input.itemId}::uuid = any(${libraryIdeas.itemIds})` : undefined,
      ),
    )
    .orderBy(desc(libraryIdeas.createdAt));
  return rows.map(ideaView);
}

export async function deleteIdea(db: Db, input: { workspaceId: string; ideaId: string }): Promise<void> {
  const deleted = await db
    .delete(libraryIdeas)
    .where(and(eq(libraryIdeas.id, input.ideaId), eq(libraryIdeas.workspaceId, input.workspaceId)))
    .returning({ id: libraryIdeas.id });
  if (deleted.length === 0) throw new LibraryError("This idea is not in your library.", "NOT_FOUND");
}

const describeStructure = (a: ItemAnalysis | null) =>
  a?.structure?.length
    ? a.structure
        .map((p) => `${p.part}${p.startS !== undefined ? ` (${formatTimestamp(p.startS)})` : ""}: ${p.summary}`)
        .join("; ")
    : null;

function ideaSource(row: ItemRow): IdeaSource {
  const a = row.analysis;
  const words =
    a?.transcript?.segments.map((s) => s.text.trim()).join(" ") ??
    row.body ??
    a?.frames
      ?.map((f) => f.text)
      .filter(Boolean)
      .join(" ") ??
    "";
  return {
    title: row.title,
    kind: row.kind,
    hook: a?.hook?.text ?? null,
    summary: a?.summary ?? null,
    structure: describeStructure(a),
    tone: a?.tone ?? [],
    excerpt: words.replace(/\s+/g, " ").trim().slice(0, 1500),
  };
}

export async function generateIdeas(
  db: Db,
  input: {
    workspaceId: string;
    kind: IdeaKind;
    itemIds: string[];
    count: number;
    durationS: number;
    wordsPerSecond: number;
    actorId?: string | null;
    brief?: string | null;
    language?: string | null;
    writer: Writer;
    signal?: AbortSignal;
  },
): Promise<IdeaView[]> {
  const rows = input.itemIds.length
    ? await db
        .select()
        .from(libraryItems)
        .where(and(eq(libraryItems.workspaceId, input.workspaceId), inArray(libraryItems.id, input.itemIds)))
    : [];
  if (rows.length !== new Set(input.itemIds).size)
    throw new LibraryError("An item you picked is not in your library.", "NOT_FOUND");
  if (rows.length === 0 && !input.brief?.trim())
    throw new LibraryError("Pick an item from your library, or say what you want.");
  if (input.kind !== "ideas" && rows.length === 0) throw new LibraryError("Pick the item to work from.");
  const unready = rows.find((r) => r.status !== "ready");
  if (unready)
    throw new LibraryError(
      `"${unready.title}" is not analysed yet. Wait for its analysis, then try again.`,
      "PRECONDITION_FAILED",
    );

  let actor: Awaited<ReturnType<typeof listActors>>[number] | null = null;
  if (input.actorId) {
    actor = (await listActors(db, {})).find((a) => a.id === input.actorId) ?? null;
    if (!actor) throw new LibraryError("That actor does not exist.", "NOT_FOUND");
  }
  const count = input.kind === "script" ? 1 : Math.min(Math.max(input.count, 1), 10);
  const language = input.language || rows.find((r) => r.analysis?.language)?.analysis?.language || "en";
  const voice = await voiceProfile(db, input.workspaceId);
  const turns = buildIdeasPrompt({
    kind: input.kind,
    count,
    sources: rows.map(ideaSource),
    durationS: input.durationS,
    wordsPerSecond: input.wordsPerSecond,
    language,
    actor: actor
      ? {
          name: actor.name,
          gender: actor.gender,
          ageRange: actor.ageRange,
          style: actor.style,
          voiceProfile: actor.voiceProfile,
        }
      : null,
    voice: voice.profile,
    brief: input.brief?.trim() || null,
  });
  // The answer is bounded to what that many ideas take in JSON, so a small
  // model that rambles stops early instead of writing for minutes: about
  // 110 tokens of keys, title, hook, roles and emotions an idea, and its
  // lines: 7 tokens a second of speech (Japanese, Chinese or Thai, which
  // have no spaces to count words by, take about that), or 1.4 a word of
  // the budget when a fast speaker's is larger.
  const budget = Math.max(8, Math.floor(input.durationS * input.wordsPerSecond));
  const maxTokens = 200 + count * (110 + Math.ceil(Math.max(input.durationS * 7, budget * 1.4)));
  const readSome = (raw: unknown) => {
    const read = readIdeas(raw, count);
    return read.length > 0 ? read : null;
  };
  const answer = await ask(input.writer, turns, ideasSchema(), readSome, {
    signal: input.signal,
    maxTokens,
    repair: `That answer cannot be used: "ideas" must hold ${count} different item${count === 1 ? "" : "s"}, each a short script of two to six lines. Answer again with only the JSON object.`,
    // An answer cut off by the token limit still holds its complete ideas.
    salvage: (text) => {
      const raw = parseJsonAnswer(text) ?? completeItems(text, "ideas");
      return raw ? readSome(raw) : null;
    },
  });
  let ideas = answer.value ?? [];
  // Over the clip's word budget, a script cannot render at that length: when
  // every idea runs well past it, ask once more with the budget spelled out,
  // then list the ideas that fit first. When the time limit ends that ask,
  // the ideas already written are kept.
  const fits = (idea: WrittenIdea) => countWords(idea.lines) <= Math.ceil(budget * 1.25);
  if (ideas.length > 0 && !ideas.some(fits)) {
    try {
      const shorter = await ask(
        input.writer,
        [
          ...turns,
          { role: "assistant", content: answer.text },
          {
            role: "user",
            content: `Those scripts are too long for ${input.durationS} seconds: each must have at most ${budget} words in all. Write the ${count} idea${count === 1 ? "" : "s"} again, much shorter, as the same JSON object.`,
          },
        ],
        ideasSchema(),
        readSome,
        { signal: input.signal, maxTokens },
      );
      if (shorter.value?.some(fits)) ideas = shorter.value;
    } catch (error) {
      if (!input.signal?.aborted) throw error;
    }
  }
  ideas = [...ideas.filter(fits), ...ideas.filter((idea) => !fits(idea))];
  if (ideas.length === 0) {
    // The answer stays in the log (the server's, or the browser's console).
    console.warn(
      JSON.stringify({
        event: "library.ideas.unreadable",
        model: input.writer.modelId,
        answer: answer.text.slice(0, 4000),
      }),
    );
    throw new LibraryError(
      `${input.writer.modelId} did not write usable scripts. Try again, or ask for fewer.`,
      "PRECONDITION_FAILED",
    );
  }
  const inserted = await db
    .insert(libraryIdeas)
    .values(
      ideas.map((idea) => ({
        workspaceId: input.workspaceId,
        itemIds: rows.map((r) => r.id),
        kind: input.kind,
        title: idea.title,
        hook: idea.hook,
        lines: idea.lines,
        actorId: actor?.id ?? null,
        language,
        provider: input.writer.provider,
        model: input.writer.modelId,
      })),
    )
    .returning();
  return inserted.map(ideaView);
}

// One click from an idea to a project with its script as the first version.
// A second click opens the same project.
export async function createProjectFromIdea(
  db: Db,
  input: {
    workspaceId: string;
    ideaId: string;
    actorId?: string | null;
    platform?: Platform;
    title?: string | null;
    modelKey?: string | null;
  },
): Promise<{ projectId: string; created: boolean }> {
  const [idea] = await db
    .select()
    .from(libraryIdeas)
    .where(and(eq(libraryIdeas.id, input.ideaId), eq(libraryIdeas.workspaceId, input.workspaceId)))
    .limit(1);
  if (!idea) throw new LibraryError("This idea is not in your library.", "NOT_FOUND");
  if (idea.projectId) return { projectId: idea.projectId, created: false };
  const actors = (await listActors(db, {})).filter((a) => a.status === "active");
  const actorId = input.actorId ?? idea.actorId ?? actors[0]?.id;
  if (!actorId) throw new LibraryError("No actor is available for the project.", "PRECONDITION_FAILED");
  const platform = input.platform ?? "tiktok";
  const format = formatOptionsFor(platform).find((f) => f.preselected)!.format;
  return db.transaction(async (tx) => {
    const conn = tx as unknown as Db;
    const project = await createProjectFromWizard(conn, {
      workspaceId: input.workspaceId,
      title: (input.title?.trim() || idea.title).slice(0, 200),
      platform,
      format,
      language: idea.language,
      actorId,
      modelKey: input.modelKey ?? null,
    });
    await saveScriptLines(conn, { projectId: project.id, origin: "chat", lines: idea.lines });
    await tx.update(libraryIdeas).set({ projectId: project.id }).where(eq(libraryIdeas.id, idea.id));
    return { projectId: project.id, created: true };
  });
}
