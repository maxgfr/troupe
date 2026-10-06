import { and, asc, desc, eq, isNull } from "drizzle-orm";

import type { Db } from "~/server/db/types";
import type { Citation, Embedder, Tool } from "../model";
import { buildLibraryChatPrompt, chatAnswerSchema, CHAT_SOURCE_CHARS, readChatAnswer, type Source } from "../prompts";
import { itemRow, searchLibrary, view, voiceProfile, type SearchHit } from "./items";
import { libraryChunks, libraryItems, libraryMessages } from "./schema";
import { ask, type Writer } from "./writer";

// The library chat, about one item or the whole library: answers that cite
// the passages they drew on.

export interface LibraryMessageView {
  id: string;
  itemId: string | null;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  provider: string | null;
  model: string | null;
  createdAt: Date;
}

const messageView = (row: typeof libraryMessages.$inferSelect): LibraryMessageView => ({
  id: row.id,
  itemId: row.itemId,
  role: row.role,
  content: row.content,
  citations: row.citations,
  provider: row.provider,
  model: row.model,
  createdAt: row.createdAt,
});

const scopeOf = (workspaceId: string, itemId: string | null | undefined) =>
  and(
    eq(libraryMessages.workspaceId, workspaceId),
    itemId ? eq(libraryMessages.itemId, itemId) : isNull(libraryMessages.itemId),
  );

export async function listLibraryMessages(
  db: Db,
  input: { workspaceId: string; itemId?: string | null },
): Promise<LibraryMessageView[]> {
  const rows = await db
    .select()
    .from(libraryMessages)
    .where(scopeOf(input.workspaceId, input.itemId))
    .orderBy(asc(libraryMessages.createdAt), asc(libraryMessages.role));
  return rows.map(messageView);
}

export async function clearLibraryMessages(
  db: Db,
  input: { workspaceId: string; itemId?: string | null },
): Promise<void> {
  await db.delete(libraryMessages).where(scopeOf(input.workspaceId, input.itemId));
}

const SOURCES = 8;

// The passages an answer may draw on: a small item whole, otherwise the ones
// closest to the question.
async function passagesFor(
  db: Db,
  input: { workspaceId: string; itemId?: string | null; message: string; embedder: Tool<Embedder> },
): Promise<SearchHit[]> {
  if (input.itemId) {
    const item = await itemRow(db, input.workspaceId, input.itemId);
    const chunks = await db
      .select()
      .from(libraryChunks)
      .where(eq(libraryChunks.itemId, item.id))
      .orderBy(asc(libraryChunks.index));
    const total = chunks.reduce((sum, c) => sum + c.text.length, 0);
    if (total <= CHAT_SOURCE_CHARS * 0.8) {
      const v = view(item);
      return chunks.map((c) => ({
        chunkId: c.id,
        itemId: item.id,
        title: v.title,
        kind: v.kind,
        thumbnailAssetId: v.thumbnailAssetId,
        text: c.text,
        startS: c.startS,
        score: 1,
      }));
    }
  }
  const result = await searchLibrary(db, {
    workspaceId: input.workspaceId,
    query: input.message,
    itemId: input.itemId ?? undefined,
    limit: SOURCES,
    embedder: input.embedder,
  });
  if (input.itemId || result.hits.length >= SOURCES / 2) return result.hits;
  // A broad question ("what works in these?") matches few passages: the
  // newest items' openings fill the rest.
  const seen = new Set(result.hits.map((h) => h.chunkId));
  const newest = await db
    .select({ chunk: libraryChunks, item: libraryItems })
    .from(libraryChunks)
    .innerJoin(libraryItems, eq(libraryItems.id, libraryChunks.itemId))
    .where(and(eq(libraryChunks.workspaceId, input.workspaceId), eq(libraryChunks.index, 0)))
    .orderBy(desc(libraryItems.createdAt))
    .limit(SOURCES);
  const fill = newest
    .filter((r) => !seen.has(r.chunk.id))
    .map((r) => {
      const v = view(r.item);
      return {
        chunkId: r.chunk.id,
        itemId: v.id,
        title: v.title,
        kind: v.kind,
        thumbnailAssetId: v.thumbnailAssetId,
        text: r.chunk.text,
        startS: r.chunk.startS,
        score: 0,
      };
    });
  return [...result.hits, ...fill].slice(0, SOURCES);
}

export async function sendLibraryMessage(
  db: Db,
  input: {
    workspaceId: string;
    itemId?: string | null;
    message: string;
    writer: Writer;
    embedder: Tool<Embedder>;
    signal?: AbortSignal;
  },
): Promise<{ user: LibraryMessageView; assistant: LibraryMessageView }> {
  const item = input.itemId ? await itemRow(db, input.workspaceId, input.itemId) : null;
  const [hits, history, voice] = await Promise.all([
    passagesFor(db, {
      workspaceId: input.workspaceId,
      itemId: input.itemId,
      message: input.message,
      embedder: input.embedder,
    }),
    listLibraryMessages(db, { workspaceId: input.workspaceId, itemId: input.itemId }),
    voiceProfile(db, input.workspaceId),
  ]);
  const sources: (Source & { hit: SearchHit })[] = hits
    .slice(0, item ? 24 : SOURCES)
    .map((h, i) => ({ n: i + 1, title: h.title, kind: h.kind, startS: h.startS, text: h.text, hit: h }));
  const turns = buildLibraryChatPrompt({
    scope: item ? { kind: "item", title: item.title } : { kind: "library" },
    sources,
    voice: voice.profile,
    history: history.map((m) => ({ role: m.role, content: m.content })),
    message: input.message,
  });
  const known = sources.map((s) => s.n);
  const answer = await ask(input.writer, turns, chatAnswerSchema(), (raw) => readChatAnswer(raw, known), {
    signal: input.signal,
  });
  const content = answer.value?.answer ?? (answer.text || "(the model sent an empty answer)");
  const cited = answer.value?.cited ?? [];
  const citations: Citation[] = cited.map((n) => {
    const s = sources[n - 1]!;
    return { n, itemId: s.hit.itemId, chunkId: s.hit.chunkId, title: s.title, kind: s.kind, startS: s.startS };
  });
  const askedAt = new Date();
  const answeredAt = new Date(askedAt.getTime() + 1);
  const [user, assistant] = await db.transaction(async (tx) => {
    const [u] = await tx
      .insert(libraryMessages)
      .values({
        workspaceId: input.workspaceId,
        itemId: item?.id ?? null,
        role: "user",
        content: input.message,
        createdAt: askedAt,
      })
      .returning();
    const [a] = await tx
      .insert(libraryMessages)
      .values({
        workspaceId: input.workspaceId,
        itemId: item?.id ?? null,
        role: "assistant",
        content,
        citations,
        provider: input.writer.provider,
        model: input.writer.modelId,
        createdAt: answeredAt,
      })
      .returning();
    return [u!, a!];
  });
  return { user: messageView(user), assistant: messageView(assistant) };
}
