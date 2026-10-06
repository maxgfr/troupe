import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { Db } from "~/server/db/types";
import { mediaAssets } from "~/modules/generation/server/media";
import type { AnalysisStep, AnalysisTools, Embedder, Frame, ItemAnalysis, StoredItemFile, Transcript } from "../model";
import { buildInsightPrompt, insightSchema, readInsights, type Insights } from "../prompts";
import { chunkText, chunkTranscript, formatTimestamp, hookFromText, hookFromTranscript, keywordTags, pacingOf } from "../text";
import { itemFiles } from "./items";
import { endAnalysis, startAnalysis } from "./running";
import { libraryChunks, libraryItems } from "./schema";

// The analysis of one saved item, the same in both editions: the tools
// (ffmpeg or the page's decoders, Whisper, a vision model, the writing model,
// an embedding model) come from the edition. A tool that is missing or fails
// skips its step and says why; the item is still searchable by what the
// other steps found.

export interface AnalysisOptions {
  // Pictures taken from a video, and how many of them the vision model reads.
  maxFrames?: number;
  visionFrames?: number;
  signal?: AbortSignal;
  removeFiles?: (files: { storagePath: string }[]) => Promise<void>;
  log?: (event: Record<string, unknown>) => void;
}

// A running analysis touches its item this often; one silent for
// STALE_AFTER_MS was cut short. An item is tried MAX_ATTEMPTS times.
export const HEARTBEAT_MS = 30_000;
export const STALE_AFTER_MS = 5 * 60_000;
export const MAX_ATTEMPTS = 3;
const DEFAULT_FRAMES = 12;
const DEFAULT_VISION_FRAMES = 6;
const EMBED_BATCH = 16;
const CTA = /\b(follow|subscribe|link in|comment|share|save this|like this|abonne|lien|commente|partage)/i;

const STEP_NAMES: Record<AnalysisStep["name"], string> = { frames: "the pictures", transcript: "the transcript", vision: "what the pictures show", insights: "the hook, structure and tags", embeddings: "search by meaning" };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 300);

// Takes the oldest queued item for analysis; null when none waits. Each
// claim counts as one attempt.
export async function claimNextItem(db: Db): Promise<string | null> {
  const rows = await db.execute<{ id: string }>(sql`
    update ${libraryItems} set status = 'analyzing', stage = 'Starting', "startedAt" = now(), "heartbeatAt" = now(), attempts = attempts + 1
    where id = (select id from ${libraryItems} where status = 'queued' order by "createdAt" limit 1 for update skip locked)
    returning id`);
  const list = (Array.isArray(rows) ? rows : (rows as { rows: { id: string }[] }).rows) as { id: string }[];
  return list[0]?.id ?? null;
}

// Analyses whose heartbeat stopped more than `olderThanMs` ago were cut
// short (a restart, a crash, a closed tab): back in the queue, or failed
// with the reason after MAX_ATTEMPTS tries, so a file that brings the
// analysis down every time cannot loop forever. An analysis running in
// another process keeps beating and is left alone. Returns the items moved.
export async function requeueStale(db: Db, olderThanMs: number): Promise<number> {
  const stale = and(eq(libraryItems.status, "analyzing"), sql`coalesce(${libraryItems.heartbeatAt}, ${libraryItems.startedAt}, ${libraryItems.createdAt}) < now() - (${Math.max(0, Math.round(olderThanMs))} * interval '1 millisecond')`);
  const rows = await db.select({ id: libraryItems.id, attempts: libraryItems.attempts, stage: libraryItems.stage }).from(libraryItems).where(stale);
  let moved = 0;
  for (const row of rows) {
    const giveUp = row.attempts >= MAX_ATTEMPTS;
    const problem = `The analysis stopped ${row.attempts} times before it finished${row.stage ? ` (the last time at "${row.stage}")` : ""}: the file may be too long or too heavy for this ${typeof window === "undefined" ? "server" : "browser"}. Read it again to try once more.`;
    const updated = await db
      .update(libraryItems)
      .set(giveUp ? { status: "failed", stage: null, problem } : { status: "queued", stage: null })
      .where(and(eq(libraryItems.id, row.id), eq(libraryItems.attempts, row.attempts), stale))
      .returning({ id: libraryItems.id });
    moved += updated.length;
  }
  return moved;
}

// The item is no longer this analysis's to finish: deleted, or taken back
// by another process.
class ItemGone extends Error {
  constructor() {
    super("The item was deleted, or is analysed elsewhere.");
    this.name = "ItemGone";
  }
}

// Touches the claim (the item, at this attempt, still analysing): false
// once the item is gone.
async function touch(db: Db, itemId: string, attempt: number, stage?: string): Promise<boolean> {
  const rows = await db
    .update(libraryItems)
    .set({ heartbeatAt: new Date(), ...(stage ? { stage } : {}) })
    .where(and(eq(libraryItems.id, itemId), eq(libraryItems.attempts, attempt), eq(libraryItems.status, "analyzing")))
    .returning({ id: libraryItems.id });
  return rows.length > 0;
}

// Pictures (and their files) left by an analysis whose item was deleted
// while it ran: the deletion listed the item's files before they existed.
async function dropLeftovers(db: Db, itemId: string, removeFiles: AnalysisOptions["removeFiles"]): Promise<number> {
  const [still] = await db.select({ id: libraryItems.id }).from(libraryItems).where(eq(libraryItems.id, itemId)).limit(1);
  if (still) return 0;
  const files = await itemFiles(db, itemId);
  if (files.length === 0) return 0;
  await db.delete(mediaAssets).where(inArray(mediaAssets.id, files.map((f) => f.id)));
  await removeFiles?.(files).catch(() => {});
  return files.length;
}

// The frames to show the vision model: spread over the video.
export function spread<T>(list: readonly T[], count: number): T[] {
  if (list.length <= count) return [...list];
  return Array.from({ length: count }, (_, i) => list[Math.round((i * (list.length - 1)) / Math.max(1, count - 1))]!);
}

function heuristicInsights(input: { words: string; hook: string | null; transcript: Transcript | null; durationS: number | null }): Insights {
  const segments = input.transcript?.segments ?? [];
  const structure: Insights["structure"] = [];
  if (input.hook) structure.push({ part: "hook", startS: 0, summary: input.hook });
  const last = segments.at(-1);
  if (last && segments.length > 1 && CTA.test(last.text)) structure.push({ part: "cta", startS: last.startS, summary: last.text.trim() });
  return { summary: "", hookWhy: "", structure, tone: [], tags: keywordTags(input.words, 5) };
}

export async function analyzeItem(db: Db, itemId: string, tools: AnalysisTools, options: AnalysisOptions = {}): Promise<void> {
  const log = options.log ?? (() => {});
  const [item] = await db.select().from(libraryItems).where(eq(libraryItems.id, itemId)).limit(1);
  if (item?.status !== "analyzing") return;
  const started = Date.now();
  const steps: AnalysisStep[] = [];
  const step = (name: AnalysisStep["name"], status: AnalysisStep["status"], detail?: string) => steps.push({ name, status, ...(detail ? { detail } : {}) });
  // This analysis's own signal: aborted by the caller, by deleting the item
  // in this process, or when the heartbeat finds the item gone.
  const run = startAnalysis(item.id, options.signal);
  const signal = run.signal;
  const attempt = item.attempts;
  const beat = setInterval(() => {
    touch(db, item.id, attempt).then(
      (alive) => {
        if (!alive) run.abort(new ItemGone());
      },
      () => {},
    );
  }, HEARTBEAT_MS);
  const setStage = async (stage: string) => {
    signal.throwIfAborted();
    if (!(await touch(db, item.id, attempt, stage))) {
      run.abort(new ItemGone());
      throw new ItemGone();
    }
  };
  try {
    let durationS = item.durationS;
    let frames: Frame[] = [];
    let cuts: number[] = [];
    let transcript: Transcript | null = null;
    let body = item.body;
    const file: StoredItemFile | null =
      item.assetId && item.mimeType ? { itemId: item.id, workspaceId: item.workspaceId, assetId: item.assetId, storagePath: "", mimeType: item.mimeType } : null;
    if (file) {
      const [asset] = await db.select({ storagePath: mediaAssets.storagePath }).from(mediaAssets).where(eq(mediaAssets.id, file.assetId)).limit(1);
      if (!asset) throw new Error("The saved file is missing. Delete the item and save it again.");
      file.storagePath = asset.storagePath;
    }

    // A new analysis replaces the frames of the last one.
    const oldFrames = (await itemFiles(db, item.id)).filter((f) => f.kind === "frame");
    if (oldFrames.length) {
      await db.delete(mediaAssets).where(inArray(mediaAssets.id, oldFrames.map((f) => f.id)));
      await options.removeFiles?.(oldFrames).catch(() => {});
    }

    if (item.kind === "video" || item.kind === "audio") {
      if (!tools.media || !file) throw new Error("This studio cannot read video or sound files.");
      await setStage("Reading the file");
      const probe = await tools.media.probe(file);
      durationS = probe.durationS ?? durationS;
      if (probe.hasVideo) {
        await setStage("Taking pictures from the video");
        try {
          const taken = await tools.media.frames(file, { max: options.maxFrames ?? DEFAULT_FRAMES, durationS, signal });
          frames = taken.frames.map((f) => ({ assetId: f.assetId, atS: f.atS }));
          cuts = taken.cutsAtS;
          step("frames", "done");
        } catch (error) {
          step("frames", "failed", `The pictures could not be taken: ${message(error)}`);
        }
      }
      if (!probe.hasAudio) step("transcript", "skipped", "The file has no sound track.");
      else if (!tools.transcriber.ready) step("transcript", "skipped", tools.transcriber.problem);
      else {
        await setStage("Transcribing");
        let audio: Awaited<ReturnType<typeof tools.media.audio>> | null = null;
        try {
          audio = await tools.media.audio(file, { signal });
        } catch (error) {
          // The file has sound this studio cannot decode: the step says why.
          step("transcript", "failed", `The sound could not be read: ${message(error)}`);
        }
        if (audio) {
          try {
            transcript = await tools.transcriber.tool.transcribe(audio, { signal });
            step("transcript", "done");
          } catch (error) {
            step("transcript", "failed", `${tools.transcriber.tool.model} could not transcribe it: ${message(error)}`);
          } finally {
            await audio.dispose?.().catch(() => {});
          }
        }
      }
    }
    if (item.kind === "image" && file) frames = [{ assetId: file.assetId, atS: 0 }];
    if (item.kind === "pdf" && !body && file) {
      if (!tools.media?.pdfText) step("insights", "skipped", "This studio cannot read PDFs.");
      else {
        await setStage("Reading the PDF");
        body = (await tools.media.pdfText(file)).trim().slice(0, 200_000) || null;
        if (!body) step("transcript", "skipped", "The PDF has no text to read (a scan needs the vision model).");
      }
    }

    if (frames.length && tools.media) {
      if (!tools.vision.ready) step("vision", "skipped", tools.vision.problem);
      else {
        const chosen = spread(frames, options.visionFrames ?? DEFAULT_VISION_FRAMES);
        let read = 0;
        let lastError = "";
        for (const [i, frame] of chosen.entries()) {
          await setStage(`Looking at the pictures (${i + 1} of ${chosen.length})`);
          try {
            const seen = await tools.vision.tool.read(await tools.media.picture(frame.assetId), { signal });
            frame.description = seen.description.trim() || undefined;
            frame.text = seen.text.trim() || undefined;
            read += 1;
          } catch (error) {
            lastError = message(error);
          }
        }
        if (read > 0) step("vision", "done");
        else step("vision", "failed", `${tools.vision.tool.model} could not read the pictures: ${lastError}`);
      }
    }

    const spokenWords = transcript?.segments.map((s) => s.text.trim()).join(" ") ?? "";
    const onScreen = frames.map((f) => f.text).filter(Boolean).join(" ");
    const words = [spokenWords, body ?? "", onScreen].filter(Boolean).join("\n");
    const opening = transcript ? hookFromTranscript(transcript.segments) : null;
    const hookText = opening?.text ?? (body ? hookFromText(body) : null) ?? (frames[0]?.text ? hookFromText(frames[0].text) : null);
    const language = transcript?.language ?? null;

    let insights: Insights | null = null;
    if (!tools.writer.ready) step("insights", "skipped", tools.writer.problem);
    else if (!words.trim() && !frames.some((f) => f.description)) step("insights", "skipped", "There is nothing to read in it.");
    else {
      await setStage("Writing the analysis");
      const transcriptText = transcript ? transcript.segments.map((s) => `[${formatTimestamp(s.startS)}] ${s.text.trim()}`).join("\n") : (body ?? "");
      const turns = buildInsightPrompt({ kind: item.kind, title: item.title, durationS, language, transcript: transcriptText, frames, hook: hookText });
      try {
        let answer = await tools.writer.tool.propose(turns, { schema: insightSchema(), signal, maxTokens: 900 });
        insights = answer.proposal === null ? null : readInsights(answer.proposal, durationS);
        if (!insights) {
          answer = await tools.writer.tool.propose([...turns, { role: "assistant", content: answer.text }, { role: "user", content: "That answer cannot be used: it does not follow the JSON schema. Answer again with only the JSON object." }], { schema: insightSchema(), signal, maxTokens: 900 });
          insights = answer.proposal === null ? null : readInsights(answer.proposal, durationS);
        }
        if (insights) step("insights", "done");
        else step("insights", "failed", `${tools.writer.modelId ?? "The model"} did not write a usable analysis.`);
      } catch (error) {
        step("insights", "failed", `${tools.writer.modelId ?? "The model"} could not write the analysis: ${message(error)}`);
      }
    }
    const found = insights ?? heuristicInsights({ words, hook: hookText, transcript, durationS });

    const thumbnailAssetId = frames.length > 1 ? await thumbnailOf(db, frames) : undefined;
    const analysis: ItemAnalysis = {
      version: 1,
      language,
      ...(thumbnailAssetId ? { thumbnailAssetId } : {}),
      ...(transcript ? { transcript } : {}),
      ...(frames.length ? { frames } : {}),
      ...(hookText ? { hook: { text: hookText, ...(opening ? { endS: opening.endS } : {}), ...(found.hookWhy ? { why: found.hookWhy } : {}) } } : {}),
      ...(found.structure.length ? { structure: found.structure } : {}),
      ...(() => {
        const pacing = pacingOf({ segments: transcript?.segments ?? [], durationS, cutsAtS: cuts });
        return pacing ? { pacing } : {};
      })(),
      ...(found.tone.length ? { tone: found.tone } : {}),
      ...(found.summary ? { summary: found.summary } : {}),
      ...(insights && tools.writer.ready ? { insightsModel: tools.writer.modelId } : {}),
      steps,
    };

    // The passages search and the chat read.
    const passages: { source: "transcript" | "text" | "frame" | "summary"; text: string; startS: number | null; endS: number | null }[] = [];
    if (found.summary) passages.push({ source: "summary", text: `${item.title}. ${found.summary}`, startS: null, endS: null });
    for (const p of chunkTranscript(transcript?.segments ?? [])) passages.push({ source: "transcript", text: p.text, startS: p.startS, endS: p.endS });
    for (const text of chunkText(body ?? "")) passages.push({ source: "text", text, startS: null, endS: null });
    for (const f of frames) {
      const seen = [f.description, f.text ? `On screen: "${f.text}"` : null].filter(Boolean).join(" ");
      if (seen) passages.push({ source: "frame", text: seen, startS: f.atS, endS: null });
    }
    if (passages.length === 0) passages.push({ source: "summary", text: item.title, startS: null, endS: null });

    let vectors: (number[] | null)[] = passages.map(() => null);
    let embedModel: string | null = null;
    if (!tools.embedder.ready) step("embeddings", "skipped", tools.embedder.problem);
    else {
      await setStage("Indexing for search");
      try {
        vectors = await embedAll(tools.embedder.tool, passages.map((p) => p.text), signal);
        embedModel = tools.embedder.tool.model;
        step("embeddings", "done");
      } catch (error) {
        step("embeddings", "failed", `${tools.embedder.tool.model} could not index it (search matches its words meanwhile): ${message(error)}`);
      }
    }

    // "Skipped: what the pictures show (why)." once per step.
    const notes = steps.filter((s) => s.status !== "done" && s.detail).map((s) => `${s.status === "failed" ? "Failed" : "Skipped"}: ${STEP_NAMES[s.name]}. ${s.detail}`);
    await setStage("Saving");
    await db.transaction(async (tx) => {
      await tx.delete(libraryChunks).where(eq(libraryChunks.itemId, item.id));
      await tx.insert(libraryChunks).values(
        passages.map((p, index) => ({ itemId: item.id, workspaceId: item.workspaceId, index, source: p.source, text: p.text, startS: p.startS, endS: p.endS, embedding: vectors[index], embedModel: vectors[index] ? embedModel : null })),
      );
      await tx
        .update(libraryItems)
        .set({ status: "ready", stage: null, problem: notes.length ? [...new Set(notes)].join(" ") : null, analysis, tags: found.tags, durationS, body, analyzedAt: new Date() })
        .where(and(eq(libraryItems.id, item.id), eq(libraryItems.attempts, attempt)));
    });
    log({ event: "library.analyzed", itemId: item.id, kind: item.kind, ms: Date.now() - started, steps: steps.map((s) => `${s.name}:${s.status}`) });
  } catch (error) {
    if (error instanceof ItemGone || signal.reason instanceof ItemGone || (signal.aborted && !options.signal?.aborted)) {
      log({ event: "library.analysis.dropped", itemId: item.id, message: message(signal.reason ?? error) });
    } else {
      // Only this attempt's claim is marked failed (deleted meanwhile: nothing to record).
      await db
        .update(libraryItems)
        .set({ status: "failed", stage: null, problem: message(error), analysis: { version: 1, steps } })
        .where(and(eq(libraryItems.id, item.id), eq(libraryItems.attempts, attempt)))
        .catch(() => {});
      log({ event: "library.analysis.failed", itemId: item.id, message: message(error) });
    }
  } finally {
    clearInterval(beat);
    endAnalysis(item.id, run);
    const dropped = await dropLeftovers(db, item.id, options.removeFiles).catch(() => 0);
    if (dropped) log({ event: "library.analysis.leftovers", itemId: item.id, files: dropped });
  }
}

// A nearly uniform picture (a black or blank opening) compresses to a
// fraction of the others' size: the thumbnail is the first frame at least a
// third as large as the median.
export async function thumbnailOf(db: Db, frames: readonly Frame[]): Promise<string | undefined> {
  const rows = await db.select({ id: mediaAssets.id, bytes: mediaAssets.bytes }).from(mediaAssets).where(inArray(mediaAssets.id, frames.map((f) => f.assetId)));
  const size = new Map(rows.map((r) => [r.id, r.bytes]));
  const sorted = [...size.values()].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return frames.find((f) => (size.get(f.assetId) ?? 0) >= median / 3)?.assetId ?? frames[0]?.assetId;
}

async function embedAll(embedder: Embedder, texts: string[], signal?: AbortSignal): Promise<number[][]> {
  const out: number[][] = [];
  for (let at = 0; at < texts.length; at += EMBED_BATCH) {
    const batch = await embedder.embed(texts.slice(at, at + EMBED_BATCH), "passage", { signal });
    if (batch.length !== Math.min(EMBED_BATCH, texts.length - at)) throw new Error("the model returned the wrong number of vectors");
    out.push(...batch);
  }
  return out;
}

// Passages the current embedding model has not read (saved while it was
// missing, or read by another model): a few at a time, from the queue.
export async function embedMissing(db: Db, embedder: Embedder, limit = 64): Promise<number> {
  const rows = await db
    .select({ id: libraryChunks.id, text: libraryChunks.text })
    .from(libraryChunks)
    .where(sql`${libraryChunks.embedModel} is distinct from ${embedder.model}`)
    .orderBy(asc(libraryChunks.itemId), asc(libraryChunks.index))
    .limit(limit);
  if (rows.length === 0) return 0;
  const vectors = await embedAll(embedder, rows.map((r) => r.text));
  for (const [i, row] of rows.entries()) {
    await db.update(libraryChunks).set({ embedding: vectors[i], embedModel: embedder.model }).where(eq(libraryChunks.id, row.id));
  }
  return rows.length;
}

// Analyses every queued item, one at a time, then indexes what was saved
// while the embedding model was missing. The edition runs one at a time.
export async function runLibraryQueue(db: Db, tools: () => Promise<AnalysisTools>, options: AnalysisOptions = {}): Promise<number> {
  let done = 0;
  for (;;) {
    if (options.signal?.aborted) return done;
    const itemId = await claimNextItem(db);
    if (!itemId) break;
    await analyzeItem(db, itemId, await tools(), options);
    done += 1;
  }
  const { embedder } = await tools();
  if (embedder.ready) {
    try {
      while ((await embedMissing(db, embedder.tool)) > 0) {
        if (options.signal?.aborted) break;
      }
    } catch (error) {
      options.log?.({ event: "library.embed.failed", message: message(error) });
    }
  }
  return done;
}
