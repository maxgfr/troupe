import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import type { Db } from "~/server/db/types";
import { mediaAssets } from "~/modules/generation/server/media";
import { LibraryError, type ClaimedUpload, type Embedder, type ItemAnalysis, type ItemKind, type ItemStatus, type Tool } from "../model";
import { keywordScore, rankByCosine, styleProfile, type VoiceSample } from "../text";
import { stopAnalysis } from "./running";
import { libraryChunks, libraryItems } from "./schema";

// Saved items: saving, reading, changing and deleting them, search over
// their passages, and the style profile of the user's own.

export type ItemRow = typeof libraryItems.$inferSelect;

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

export function view(row: ItemRow): LibraryItemView {
  const a = row.analysis;
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    sourceUrl: row.sourceUrl,
    fileName: row.fileName,
    mimeType: row.mimeType,
    assetId: row.assetId,
    thumbnailAssetId: row.kind === "image" ? row.assetId : (a?.thumbnailAssetId ?? a?.frames?.[0]?.assetId ?? null),
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

export async function itemRow(db: Db, workspaceId: string, itemId: string): Promise<ItemRow> {
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
  const [updated] = await db.update(libraryItems).set({ status: "queued", stage: null, problem: null, startedAt: null, heartbeatAt: null, attempts: 0 }).where(eq(libraryItems.id, row.id)).returning();
  return view(updated!);
}

// Deletes the item with its passages and chat; returns the stored files for
// the caller to remove once the rows are gone.
// An analysis running in this process stops at once; one in another process
// stops at its next heartbeat. Either removes the pictures it takes meanwhile.
export async function deleteItem(db: Db, input: { workspaceId: string; itemId: string }): Promise<{ files: { storagePath: string }[] }> {
  await itemRow(db, input.workspaceId, input.itemId);
  const deleted = await db.transaction(async (tx) => {
    const conn = tx as unknown as Db;
    const files = await itemFiles(conn, input.itemId);
    await tx.delete(libraryItems).where(eq(libraryItems.id, input.itemId));
    if (files.length) await tx.delete(mediaAssets).where(inArray(mediaAssets.id, files.map((f) => f.id)));
    return { files: files.map((f) => ({ storagePath: f.storagePath })) };
  });
  stopAnalysis(input.itemId);
  return deleted;
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
