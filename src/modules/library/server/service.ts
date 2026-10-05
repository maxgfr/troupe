import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";

import type { Db } from "~/server/db/types";
import { listActors } from "~/modules/actors";
import type { ChatModel, ChatTurn } from "~/modules/chat";
import { parseJsonAnswer } from "~/modules/chat";
import { mediaAssets } from "~/modules/generation/server/media";
import { saveScriptLines } from "~/modules/script";
import { createProjectFromWizard, formatOptionsFor, type Platform } from "~/modules/studio";
import { LibraryError, type Citation, type ClaimedUpload, type Embedder, type ItemAnalysis, type ItemKind, type ItemStatus, type Tool } from "../model";
import {
  buildIdeasPrompt,
  buildLibraryChatPrompt,
  chatAnswerSchema,
  CHAT_SOURCE_CHARS,
  ideasSchema,
  readChatAnswer,
  readIdeas,
  type IdeaKind,
  type IdeaSource,
  type Source,
} from "../prompts";
import { formatTimestamp, keywordScore, rankByCosine, styleProfile, type VoiceSample } from "../text";
import { libraryChunks, libraryIdeas, libraryItems, libraryMessages } from "./schema";

type ItemRow = typeof libraryItems.$inferSelect;

export const MAX_TEXT_CHARS = 200_000;

// --- Views ----------------------------------------------------------------

export interface LibraryItemView {
  id: string;
  kind: ItemKind;
  title: string;
  sourceUrl: string | null;
  fileName: string | null;
  mimeType: string | null;
  assetId: string | null;
  // A picture for the list: the first frame of a video, the image itself.
  thumbnailAssetId: string | null;
  durationS: number | null;
  mine: boolean;
  status: ItemStatus;
  stage: string | null;
  problem: string | null;
  tags: string[];
  hook: string | null;
  summary: string | null;
  createdAt: Date;
  analyzedAt: Date | null;
}

export interface LibraryItemDetail extends LibraryItemView {
  body: string | null;
  analysis: ItemAnalysis | null;
  passages: number;
  embedded: number;
}

function view(row: ItemRow): LibraryItemView {
  const a = row.analysis;
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    sourceUrl: row.sourceUrl,
    fileName: row.fileName,
    mimeType: row.mimeType,
    assetId: row.assetId,
    thumbnailAssetId: row.kind === "image" ? row.assetId : (a?.frames?.[0]?.assetId ?? null),
    durationS: row.durationS,
    mine: row.mine,
    status: row.status,
    stage: row.stage,
    problem: row.problem,
    tags: row.tags,
    hook: a?.hook?.text ?? null,
    summary: a?.summary ?? null,
    createdAt: row.createdAt,
    analyzedAt: row.analyzedAt,
  };
}

async function itemRow(db: Db, workspaceId: string, itemId: string): Promise<ItemRow> {
  const [row] = await db.select().from(libraryItems).where(and(eq(libraryItems.id, itemId), eq(libraryItems.workspaceId, workspaceId))).limit(1);
  if (!row) throw new LibraryError("This item is not in your library.", "NOT_FOUND");
  return row;
}

// --- Saving ---------------------------------------------------------------

export function kindForMime(mimeType: string): ItemKind | null {
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "text/plain" || mimeType === "text/markdown") return "text";
  return null;
}

const untitled = (text: string) => {
  const first = text.trim().split(/\n/)[0]!.trim();
  return (first.length > 80 ? `${first.slice(0, 79)}…` : first) || "Untitled note";
};

const stem = (fileName: string) => fileName.replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/[_-]+/g, " ").trim() || fileName;

export async function addTextItem(db: Db, input: { workspaceId: string; text: string; title?: string | null; mine?: boolean; fileName?: string | null }): Promise<LibraryItemView> {
  const text = input.text.replace(/\r\n/g, "\n").trim();
  if (!text) throw new LibraryError("The text is empty.");
  if (text.length > MAX_TEXT_CHARS) throw new LibraryError(`The text is longer than ${MAX_TEXT_CHARS.toLocaleString("en")} characters. Save a shorter part of it.`);
  const [row] = await db
    .insert(libraryItems)
    .values({ workspaceId: input.workspaceId, kind: "text", title: input.title?.trim() || (input.fileName ? stem(input.fileName) : untitled(text)), body: text, fileName: input.fileName ?? null, mine: input.mine ?? false })
    .returning();
  return view(row!);
}

export async function addArticleItem(db: Db, input: { workspaceId: string; url: string; title: string; text: string; mine?: boolean }): Promise<LibraryItemView> {
  const text = input.text.trim().slice(0, MAX_TEXT_CHARS);
  if (!text) throw new LibraryError("That page has no readable text.");
  const [row] = await db
    .insert(libraryItems)
    .values({ workspaceId: input.workspaceId, kind: "article", title: input.title.trim().slice(0, 300) || input.url, sourceUrl: input.url, body: text, mine: input.mine ?? false })
    .returning();
  return view(row!);
}

// A stored file (an upload, or a video fetched from a link) becomes a media
// asset of the workspace and an item that waits for its analysis.
export async function addFileItem(
  db: Db,
  input: { workspaceId: string; itemId?: string; file: ClaimedUpload; title?: string | null; sourceUrl?: string | null; mine?: boolean; durationS?: number | null },
): Promise<LibraryItemView> {
  const kind = kindForMime(input.file.mimeType);
  if (!kind || kind === "text") throw new LibraryError("Troupe's library takes videos, sound, pictures, PDFs and text files.");
  return db.transaction(async (tx) => {
    await tx
      .insert(mediaAssets)
      .values({ id: input.file.assetId, workspaceId: input.workspaceId, kind: "library", storagePath: input.file.storagePath, mimeType: input.file.mimeType, bytes: input.file.bytes, checksum: input.file.checksum, meta: { storage: "local", ...(input.itemId ? { itemId: input.itemId } : {}) } });
    const [row] = await tx
      .insert(libraryItems)
      .values({
        ...(input.itemId ? { id: input.itemId } : {}),
        workspaceId: input.workspaceId,
        kind,
        title: input.title?.trim() || stem(input.file.fileName),
        fileName: input.file.fileName,
        sourceUrl: input.sourceUrl ?? null,
        assetId: input.file.assetId,
        mimeType: input.file.mimeType,
        durationS: input.durationS ?? null,
        mine: input.mine ?? false,
      })
      .returning();
    return view(row!);
  });
}

// --- Reading --------------------------------------------------------------

export async function listItems(db: Db, input: { workspaceId: string; kind?: ItemKind; mine?: boolean; tag?: string }): Promise<LibraryItemView[]> {
  const where: SQL[] = [eq(libraryItems.workspaceId, input.workspaceId)];
  if (input.kind) where.push(eq(libraryItems.kind, input.kind));
  if (input.mine !== undefined) where.push(eq(libraryItems.mine, input.mine));
  if (input.tag) where.push(sql`${input.tag.toLowerCase()} = any(${libraryItems.tags})`);
  const rows = await db.select().from(libraryItems).where(and(...where)).orderBy(desc(libraryItems.createdAt));
  return rows.map(view);
}

export async function getItem(db: Db, workspaceId: string, itemId: string): Promise<LibraryItemDetail> {
  const row = await itemRow(db, workspaceId, itemId);
  const [counts] = await db
    .select({ passages: sql<number>`count(*)::int`, embedded: sql<number>`count(${libraryChunks.embedding})::int` })
    .from(libraryChunks)
    .where(eq(libraryChunks.itemId, itemId));
  return { ...view(row), body: row.body, analysis: row.analysis, passages: counts?.passages ?? 0, embedded: counts?.embedded ?? 0 };
}

// The item's stored file and frames, for the analysis and for deletion.
export async function itemFiles(db: Db, itemId: string): Promise<{ id: string; storagePath: string; kind: string }[]> {
  return db
    .select({ id: mediaAssets.id, storagePath: mediaAssets.storagePath, kind: mediaAssets.kind })
    .from(mediaAssets)
    .where(and(inArray(mediaAssets.kind, ["library", "frame"]), sql`${mediaAssets.meta}->>'itemId' = ${itemId}`));
}

// --- Changing -------------------------------------------------------------

export async function updateItem(db: Db, input: { workspaceId: string; itemId: string; mine?: boolean; title?: string }): Promise<LibraryItemView> {
  await itemRow(db, input.workspaceId, input.itemId);
  const patch: Partial<typeof libraryItems.$inferInsert> = {};
  if (input.mine !== undefined) patch.mine = input.mine;
  if (input.title?.trim()) patch.title = input.title.trim().slice(0, 300);
  if (Object.keys(patch).length === 0) return view(await itemRow(db, input.workspaceId, input.itemId));
  const [row] = await db.update(libraryItems).set(patch).where(eq(libraryItems.id, input.itemId)).returning();
  return view(row!);
}

// Back in the queue; the next analysis replaces this one's results.
export async function requeueItem(db: Db, input: { workspaceId: string; itemId: string }): Promise<LibraryItemView> {
  const row = await itemRow(db, input.workspaceId, input.itemId);
  if (row.status === "queued" || row.status === "analyzing") return view(row);
  const [updated] = await db.update(libraryItems).set({ status: "queued", stage: null, problem: null, startedAt: null }).where(eq(libraryItems.id, row.id)).returning();
  return view(updated!);
}

// Deletes the item with its passages and chat; returns the stored files for
// the caller to remove once the rows are gone.
export async function deleteItem(db: Db, input: { workspaceId: string; itemId: string }): Promise<{ files: { storagePath: string }[] }> {
  await itemRow(db, input.workspaceId, input.itemId);
  return db.transaction(async (tx) => {
    const conn = tx as unknown as Db;
    const files = await itemFiles(conn, input.itemId);
    await tx.delete(libraryItems).where(eq(libraryItems.id, input.itemId));
    if (files.length) await tx.delete(mediaAssets).where(inArray(mediaAssets.id, files.map((f) => f.id)));
    return { files: files.map((f) => ({ storagePath: f.storagePath })) };
  });
}

// --- Search ---------------------------------------------------------------

export interface SearchHit {
  chunkId: string;
  itemId: string;
  title: string;
  kind: ItemKind;
  thumbnailAssetId: string | null;
  text: string;
  startS: number | null;
  score: number;
}

export interface SearchResult {
  mode: "semantic" | "keyword";
  hits: SearchHit[];
  // Why the search fell back to keywords, if it did.
  note: string | null;
}

const KEYWORD_SCAN = 20_000;

// Passages closest to the query: by meaning when an embedding model has read
// them, by keywords otherwise (and for passages it has not read yet).
export async function searchLibrary(db: Db, input: { workspaceId: string; query: string; itemId?: string; limit?: number; embedder: Tool<Embedder> }): Promise<SearchResult> {
  const limit = Math.min(Math.max(input.limit ?? 12, 1), 50);
  const query = input.query.trim();
  if (!query) return { mode: "keyword", hits: [], note: null };
  const scope = and(eq(libraryChunks.workspaceId, input.workspaceId), input.itemId ? eq(libraryChunks.itemId, input.itemId) : undefined);
  const items = new Map((await db.select().from(libraryItems).where(eq(libraryItems.workspaceId, input.workspaceId))).map((r) => [r.id, view(r)]));
  const hit = (c: { id: string; itemId: string; text: string; startS: number | null }, score: number): SearchHit | null => {
    const item = items.get(c.itemId);
    return item ? { chunkId: c.id, itemId: c.itemId, title: item.title, kind: item.kind, thumbnailAssetId: item.thumbnailAssetId, text: c.text, startS: c.startS, score } : null;
  };

  let note: string | null = input.embedder.ready ? null : input.embedder.problem;
  if (input.embedder.ready) {
    const model = input.embedder.tool.model;
    const candidates = await db
      .select({ id: libraryChunks.id, itemId: libraryChunks.itemId, text: libraryChunks.text, startS: libraryChunks.startS, embedding: libraryChunks.embedding })
      .from(libraryChunks)
      .where(and(scope, eq(libraryChunks.embedModel, model)));
    if (candidates.length > 0) {
      try {
        const [vector] = await input.embedder.tool.embed([query], "query");
        const ranked = rankByCosine(vector!, candidates.map((c) => ({ ...c, embedding: c.embedding ?? [] })), limit);
        const hits = ranked.map((r) => hit(r.item, Math.round(r.score * 1000) / 1000)).filter((h): h is SearchHit => h !== null && h.score > 0);
        // Passages not embedded yet still show up when their words match.
        const [{ pending } = { pending: 0 }] = await db.select({ pending: sql<number>`count(*)::int` }).from(libraryChunks).where(and(scope, sql`${libraryChunks.embedModel} is distinct from ${model}`));
        if (pending === 0) return { mode: "semantic", hits, note: null };
        const extra = await keywordHits(db, and(scope, sql`${libraryChunks.embedModel} is distinct from ${model}`)!, query, limit, hit);
        return { mode: "semantic", hits: [...hits, ...extra.map((h) => ({ ...h, score: 0 }))].slice(0, limit), note: `${pending} passage${pending === 1 ? " is" : "s are"} not read by ${model} yet; they are matched by keywords.` };
      } catch (error) {
        note = `The embedding model could not answer (${error instanceof Error ? error.message : String(error)}); searching by keywords.`;
      }
    } else note = "No passage has been read by the embedding model yet; searching by keywords.";
  }
  return { mode: "keyword", hits: await keywordHits(db, scope!, query, limit, hit), note };
}

async function keywordHits(db: Db, where: SQL, query: string, limit: number, hit: (c: { id: string; itemId: string; text: string; startS: number | null }, score: number) => SearchHit | null): Promise<SearchHit[]> {
  const rows = await db
    .select({ id: libraryChunks.id, itemId: libraryChunks.itemId, text: libraryChunks.text, startS: libraryChunks.startS })
    .from(libraryChunks)
    .where(where)
    .limit(KEYWORD_SCAN);
  return rows
    .map((r) => ({ r, score: keywordScore(query, r.text) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => hit(x.r, x.score))
    .filter((h): h is SearchHit => h !== null);
}

// --- Style memory ---------------------------------------------------------

// The style profile of the items marked "my content", or null without any.
export async function voiceProfile(db: Db, workspaceId: string): Promise<{ profile: string | null; items: number }> {
  const rows = await db
    .select()
    .from(libraryItems)
    .where(and(eq(libraryItems.workspaceId, workspaceId), eq(libraryItems.mine, true), eq(libraryItems.status, "ready")))
    .orderBy(desc(libraryItems.createdAt))
    .limit(20);
  const samples: VoiceSample[] = rows.map((r) => ({
    title: r.title,
    hook: r.analysis?.hook?.text ?? null,
    tone: r.analysis?.tone ?? [],
    wordsPerSecond: r.analysis?.pacing?.wordsPerSecond ?? null,
    text: (r.analysis?.transcript?.segments.map((s) => s.text).join(" ") ?? r.body ?? "").slice(0, 3000),
  }));
  return { profile: styleProfile(samples), items: rows.length };
}

// --- Library chat ---------------------------------------------------------

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
  and(eq(libraryMessages.workspaceId, workspaceId), itemId ? eq(libraryMessages.itemId, itemId) : isNull(libraryMessages.itemId));

export async function listLibraryMessages(db: Db, input: { workspaceId: string; itemId?: string | null }): Promise<LibraryMessageView[]> {
  const rows = await db.select().from(libraryMessages).where(scopeOf(input.workspaceId, input.itemId)).orderBy(asc(libraryMessages.createdAt), asc(libraryMessages.role));
  return rows.map(messageView);
}

export async function clearLibraryMessages(db: Db, input: { workspaceId: string; itemId?: string | null }): Promise<void> {
  await db.delete(libraryMessages).where(scopeOf(input.workspaceId, input.itemId));
}

export interface Writer {
  model: ChatModel;
  provider: string;
  modelId: string;
}

const SOURCES = 8;

// The passages an answer may draw on: a small item whole, otherwise the ones
// closest to the question.
async function passagesFor(db: Db, input: { workspaceId: string; itemId?: string | null; message: string; embedder: Tool<Embedder> }): Promise<SearchHit[]> {
  if (input.itemId) {
    const item = await itemRow(db, input.workspaceId, input.itemId);
    const chunks = await db.select().from(libraryChunks).where(eq(libraryChunks.itemId, item.id)).orderBy(asc(libraryChunks.index));
    const total = chunks.reduce((sum, c) => sum + c.text.length, 0);
    if (total <= CHAT_SOURCE_CHARS * 0.8) {
      const v = view(item);
      return chunks.map((c) => ({ chunkId: c.id, itemId: item.id, title: v.title, kind: v.kind, thumbnailAssetId: v.thumbnailAssetId, text: c.text, startS: c.startS, score: 1 }));
    }
  }
  const result = await searchLibrary(db, { workspaceId: input.workspaceId, query: input.message, itemId: input.itemId ?? undefined, limit: SOURCES, embedder: input.embedder });
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
      return { chunkId: r.chunk.id, itemId: v.id, title: v.title, kind: v.kind, thumbnailAssetId: v.thumbnailAssetId, text: r.chunk.text, startS: r.chunk.startS, score: 0 };
    });
  return [...result.hits, ...fill].slice(0, SOURCES);
}

// One answer in the schema, with one more try when it cannot be read.
async function ask<T>(writer: Writer, turns: ChatTurn[], schema: Parameters<ChatModel["propose"]>[1]["schema"], read: (raw: unknown) => T | null, options: { signal?: AbortSignal; maxTokens?: number }): Promise<{ text: string; value: T | null }> {
  const first = await writer.model.propose(turns, { schema, signal: options.signal, maxTokens: options.maxTokens });
  const firstValue = first.proposal === null ? null : read(first.proposal);
  if (firstValue !== null) return { text: first.text, value: firstValue };
  const second = await writer.model.propose(
    [...turns, { role: "assistant", content: first.text }, { role: "user", content: "That answer cannot be used: it does not follow the JSON schema. Answer again with only the JSON object, following the same rules." }],
    { schema, signal: options.signal, maxTokens: options.maxTokens },
  );
  const secondValue = second.proposal === null ? null : read(second.proposal);
  return { text: second.text.trim() || first.text.trim(), value: secondValue };
}

export async function sendLibraryMessage(
  db: Db,
  input: { workspaceId: string; itemId?: string | null; message: string; writer: Writer; embedder: Tool<Embedder>; signal?: AbortSignal },
): Promise<{ user: LibraryMessageView; assistant: LibraryMessageView }> {
  const item = input.itemId ? await itemRow(db, input.workspaceId, input.itemId) : null;
  const [hits, history, voice] = await Promise.all([
    passagesFor(db, { workspaceId: input.workspaceId, itemId: input.itemId, message: input.message, embedder: input.embedder }),
    listLibraryMessages(db, { workspaceId: input.workspaceId, itemId: input.itemId }),
    voiceProfile(db, input.workspaceId),
  ]);
  const sources: (Source & { hit: SearchHit })[] = hits.slice(0, item ? 24 : SOURCES).map((h, i) => ({ n: i + 1, title: h.title, kind: h.kind, startS: h.startS, text: h.text, hit: h }));
  const turns = buildLibraryChatPrompt({
    scope: item ? { kind: "item", title: item.title } : { kind: "library" },
    sources,
    voice: voice.profile,
    history: history.map((m) => ({ role: m.role, content: m.content })),
    message: input.message,
  });
  const known = sources.map((s) => s.n);
  const answer = await ask(input.writer, turns, chatAnswerSchema(), (raw) => readChatAnswer(raw, known), { signal: input.signal });
  const content = answer.value?.answer ?? (answer.text || "(the model sent an empty answer)");
  const cited = answer.value?.cited ?? [];
  const citations: Citation[] = cited.map((n) => {
    const s = sources[n - 1]!;
    return { n, itemId: s.hit.itemId, chunkId: s.hit.chunkId, title: s.title, kind: s.kind, startS: s.startS };
  });
  const askedAt = new Date();
  const answeredAt = new Date(askedAt.getTime() + 1);
  const [user, assistant] = await db.transaction(async (tx) => {
    const [u] = await tx.insert(libraryMessages).values({ workspaceId: input.workspaceId, itemId: item?.id ?? null, role: "user", content: input.message, createdAt: askedAt }).returning();
    const [a] = await tx
      .insert(libraryMessages)
      .values({ workspaceId: input.workspaceId, itemId: item?.id ?? null, role: "assistant", content, citations, provider: input.writer.provider, model: input.writer.modelId, createdAt: answeredAt })
      .returning();
    return [u!, a!];
  });
  return { user: messageView(user), assistant: messageView(assistant) };
}

// --- Ideas ----------------------------------------------------------------

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
    .where(and(eq(libraryIdeas.workspaceId, input.workspaceId), input.itemId ? sql`${input.itemId}::uuid = any(${libraryIdeas.itemIds})` : undefined))
    .orderBy(desc(libraryIdeas.createdAt));
  return rows.map(ideaView);
}

export async function deleteIdea(db: Db, input: { workspaceId: string; ideaId: string }): Promise<void> {
  const deleted = await db.delete(libraryIdeas).where(and(eq(libraryIdeas.id, input.ideaId), eq(libraryIdeas.workspaceId, input.workspaceId))).returning({ id: libraryIdeas.id });
  if (deleted.length === 0) throw new LibraryError("This idea is not in your library.", "NOT_FOUND");
}

const describeStructure = (a: ItemAnalysis | null) =>
  a?.structure?.length ? a.structure.map((p) => `${p.part}${p.startS !== undefined ? ` (${formatTimestamp(p.startS)})` : ""}: ${p.summary}`).join("; ") : null;

function ideaSource(row: ItemRow): IdeaSource {
  const a = row.analysis;
  const words = a?.transcript?.segments.map((s) => s.text.trim()).join(" ") ?? row.body ?? a?.frames?.map((f) => f.text).filter(Boolean).join(" ") ?? "";
  return { title: row.title, kind: row.kind, hook: a?.hook?.text ?? null, summary: a?.summary ?? null, structure: describeStructure(a), tone: a?.tone ?? [], excerpt: words.replace(/\s+/g, " ").trim().slice(0, 1500) };
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
    ? await db.select().from(libraryItems).where(and(eq(libraryItems.workspaceId, input.workspaceId), inArray(libraryItems.id, input.itemIds)))
    : [];
  if (rows.length !== new Set(input.itemIds).size) throw new LibraryError("An item you picked is not in your library.", "NOT_FOUND");
  if (rows.length === 0 && !input.brief?.trim()) throw new LibraryError("Pick an item from your library, or say what you want.");
  if (input.kind !== "ideas" && rows.length === 0) throw new LibraryError("Pick the item to work from.");
  const unready = rows.find((r) => r.status !== "ready");
  if (unready) throw new LibraryError(`"${unready.title}" is not analysed yet. Wait for its analysis, then try again.`, "PRECONDITION_FAILED");

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
    actor: actor ? { name: actor.name, gender: actor.gender, ageRange: actor.ageRange, style: actor.style, voiceProfile: actor.voiceProfile } : null,
    voice: voice.profile,
    brief: input.brief?.trim() || null,
  });
  const answer = await ask(input.writer, turns, ideasSchema(), (raw) => {
    const read = readIdeas(raw, count);
    return read.length > 0 ? read : null;
  }, { signal: input.signal, maxTokens: 400 + count * 220 });
  let ideas = answer.value ?? [];
  if (ideas.length === 0) {
    const raw = answer.text ? parseJsonAnswer(answer.text) : null;
    ideas = raw ? readIdeas(raw, count) : [];
  }
  if (ideas.length === 0) {
    // The answer stays in the log (the server's, or the browser's console).
    console.warn(JSON.stringify({ event: "library.ideas.unreadable", model: input.writer.modelId, answer: answer.text.slice(0, 4000) }));
    throw new LibraryError(`${input.writer.modelId} did not write usable scripts. Try again, or ask for fewer.`, "PRECONDITION_FAILED");
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
  input: { workspaceId: string; ideaId: string; actorId?: string | null; platform?: Platform; title?: string | null; modelKey?: string | null },
): Promise<{ projectId: string; created: boolean }> {
  const [idea] = await db.select().from(libraryIdeas).where(and(eq(libraryIdeas.id, input.ideaId), eq(libraryIdeas.workspaceId, input.workspaceId))).limit(1);
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
