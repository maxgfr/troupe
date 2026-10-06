import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure, workspaceProcedure } from "~/server/api/trpc";
import type { MediaLinks } from "~/server/media/store";
import { ChatProviderError } from "~/modules/chat";
import {
  addArticleItem,
  addFileItem,
  addTextItem,
  clearLibraryMessages,
  createProjectFromIdea,
  deleteIdea,
  deleteItem,
  generateIdeas,
  getItem,
  IDEA_KINDS,
  ITEM_KINDS,
  LibraryError,
  listIdeas,
  listItems,
  listLibraryMessages,
  MAX_TEXT_CHARS,
  requeueItem,
  searchLibrary,
  sendLibraryMessage,
  updateItem,
  voiceProfile,
  type LibraryBackend,
  type LibraryItemDetail,
  type LibraryItemView,
  type Writer,
} from "~/modules/library";
import { ActorUnavailableError } from "~/modules/actors";
import type { ModelCatalog } from "~/modules/models";
import { modelOptionsFor } from "~/modules/studio";
import { MODEL_KEY } from "./generation";

const NO_LIBRARY = "The inspiration library is not available in this studio.";
const ITEM = z.object({ itemId: z.string().uuid() });
const PLATFORM = z.enum(["instagram", "youtube", "tiktok", "linkedin"]);

function backend(library: LibraryBackend | null): LibraryBackend {
  if (!library) throw new TRPCError({ code: "PRECONDITION_FAILED", message: NO_LIBRARY });
  return library;
}

// Domain errors as tRPC errors; anything else stays an internal error.
function asTrpcError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof LibraryError) throw new TRPCError({ code: error.code, message: error.message });
  if (error instanceof ChatProviderError) throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
  if (error instanceof ActorUnavailableError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  throw error;
}

const withUrls = (media: MediaLinks, item: LibraryItemView) => ({
  ...item,
  mediaUrl: item.assetId ? media.urlFor(item.assetId) : null,
  downloadUrl: item.assetId ? media.urlFor(item.assetId, { download: true }) : null,
  thumbnailUrl: item.thumbnailAssetId ? media.urlFor(item.thumbnailAssetId) : null,
});

const detailWithUrls = (media: MediaLinks, item: LibraryItemDetail) => ({
  ...withUrls(media, item),
  body: item.body,
  passages: item.passages,
  embedded: item.embedded,
  analysis: item.analysis ? { ...item.analysis, frames: item.analysis.frames?.map((f) => ({ ...f, url: media.urlFor(f.assetId) })) } : null,
});

// The writing model: the script chat's, as set in Settings.
// Ideas last 20 s, or less when the studio's default render model (the one
// a project made of an idea gets, in 9:16) makes only shorter clips: that
// project then launches as it is.
function ideaSeconds(catalog: ModelCatalog): number {
  const usable = modelOptionsFor(catalog.models, { format: "9:16" }).filter((m) => m.available && m.compatible);
  const model = usable.find((m) => m.key === catalog.defaultModelKey) ?? usable[0];
  const longest = model ? Math.max(0, ...model.capabilities.durationsS) : 0;
  return longest >= 4 ? Math.min(20, longest) : 20;
}

async function writerOf(chat: { load(): Promise<{ model: Writer["model"] | null; problem: string | null; provider: string; modelId: string; wordsPerSecond: number }> } | null) {
  if (!chat) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No chat model is set up, and the library writes with it." });
  const setup = await chat.load();
  if (!setup.model) throw new TRPCError({ code: "PRECONDITION_FAILED", message: setup.problem ?? "No chat model is set up. Choose one in Settings." });
  return { writer: { model: setup.model, provider: setup.provider, modelId: setup.modelId } satisfies Writer, wordsPerSecond: setup.wordsPerSecond };
}

// One writing request (an answer, a set of ideas) gets a time limit for all
// its model calls together: a small model on a slow CPU, or one that
// rambles to its token limit and is asked again, must not hold the page
// for ever. Its calls are stopped when the limit passes.
function timeLimit(signal: AbortSignal | undefined, timeoutMs: number) {
  const limit = AbortSignal.timeout(timeoutMs);
  return { timeoutMs, limit, signal: signal ? AbortSignal.any([signal, limit]) : limit };
}

// Model failures are logged, not shown: they may name hosts or data. One
// past the time limit says so, with what to do.
function modelFailure(error: unknown, signal: AbortSignal | undefined, label: string, timed?: { limit: AbortSignal; timeoutMs: number; doing: string; next: string }): never {
  if (timed?.limit.aborted && !signal?.aborted) {
    throw new TRPCError({ code: "TIMEOUT", message: `${label} took longer than ${Math.max(1, Math.round(timed.timeoutMs / 1000))} s to ${timed.doing} and was stopped. ${timed.next}` });
  }
  if (signal?.aborted) throw new TRPCError({ code: "CLIENT_CLOSED_REQUEST", message: "The request was stopped." });
  if (error instanceof TRPCError || error instanceof LibraryError || error instanceof ChatProviderError) asTrpcError(error);
  console.error(JSON.stringify({ event: "library.model.failed", message: (error as Error).message }));
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `${label} could not answer. Try again; the server's log has the details.` });
}

// The inspiration library: save, analyse, search, chat, ideas. Every call
// is scoped to a workspace the caller belongs to (workspaceProcedure), and
// every item, idea and message id is checked against it.
export const libraryRouter = createTRPCRouter({
  status: protectedProcedure.query(({ ctx }) => backend(ctx.library).status()),

  list: workspaceProcedure
    .input(z.object({ kind: z.enum(ITEM_KINDS).optional(), mine: z.boolean().optional(), tag: z.string().max(40).optional() }))
    .query(async ({ ctx, input }) => (await listItems(ctx.db, input)).map((item) => withUrls(ctx.media, item))),

  get: workspaceProcedure.input(ITEM).query(async ({ ctx, input }) => detailWithUrls(ctx.media, await getItem(ctx.db, input.workspaceId, input.itemId).catch(asTrpcError))),

  addText: workspaceProcedure
    .input(z.object({ text: z.string().min(1).max(MAX_TEXT_CHARS), title: z.string().max(300).nullish(), mine: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const library = backend(ctx.library);
      const item = await addTextItem(ctx.db, input).catch(asTrpcError);
      library.schedule();
      return withUrls(ctx.media, item);
    }),

  // A page (kept as an article) or a video (downloaded, then analysed).
  addUrl: workspaceProcedure
    .input(z.object({ url: z.string().trim().min(1).max(2000), title: z.string().max(300).nullish(), mine: z.boolean().optional() }))
    .mutation(async ({ ctx, input, signal }) => {
      const library = backend(ctx.library);
      if (!library.fetchUrl || !library.adoptFile) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A page in your browser cannot fetch other sites. Save the video or the text to a file and add it here, or paste the text." });
      }
      try {
        const source = await library.fetchUrl(input.url, { signal });
        if (source.kind === "article") {
          const item = await addArticleItem(ctx.db, { workspaceId: input.workspaceId, url: source.url, title: input.title?.trim() || source.title, text: source.text, mine: input.mine });
          library.schedule();
          return withUrls(ctx.media, item);
        }
        const itemId = crypto.randomUUID();
        try {
          const file = await library.adoptFile(source, { workspaceId: input.workspaceId, itemId });
          // Not recorded: the stored original goes too.
          const item = await addFileItem(ctx.db, { workspaceId: input.workspaceId, itemId, file, title: input.title?.trim() || source.title, sourceUrl: source.url, mine: input.mine, durationS: source.durationS ?? null }).catch(async (error: unknown) => {
            await library.removeFiles([{ storagePath: file.storagePath }]).catch(() => {});
            throw error;
          });
          library.schedule();
          return withUrls(ctx.media, item);
        } finally {
          await source.dispose();
        }
      } catch (error) {
        asTrpcError(error);
      }
    }),

  // The browser edition's uploads: the page stores the file, then this
  // records it. The self-hosted studio takes uploads at /api/library/upload.
  addUpload: workspaceProcedure
    .input(z.object({ uploadId: z.string().uuid(), title: z.string().max(300).nullish(), mine: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const library = backend(ctx.library);
      if (!library.claimUpload) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Upload files with POST /api/library/upload." });
      try {
        const file = await library.claimUpload(input.uploadId);
        const item = await addFileItem(ctx.db, { workspaceId: input.workspaceId, itemId: input.uploadId, file, title: input.title, mine: input.mine });
        library.schedule();
        return withUrls(ctx.media, item);
      } catch (error) {
        asTrpcError(error);
      }
    }),

  update: workspaceProcedure
    .input(ITEM.extend({ mine: z.boolean().optional(), title: z.string().trim().min(1).max(300).optional() }))
    .mutation(async ({ ctx, input }) => withUrls(ctx.media, await updateItem(ctx.db, input).catch(asTrpcError))),

  reanalyze: workspaceProcedure.input(ITEM).mutation(async ({ ctx, input }) => {
    const library = backend(ctx.library);
    const item = await requeueItem(ctx.db, input).catch(asTrpcError);
    library.schedule();
    return withUrls(ctx.media, item);
  }),

  delete: workspaceProcedure.input(ITEM).mutation(async ({ ctx, input }) => {
    const { files } = await deleteItem(ctx.db, input).catch(asTrpcError);
    try {
      await ctx.library?.removeFiles(files);
    } catch (error) {
      console.error(JSON.stringify({ event: "library.files.remove.failed", itemId: input.itemId, message: (error as Error).message }));
    }
    return { deleted: true };
  }),

  search: workspaceProcedure
    .input(z.object({ query: z.string().trim().min(1).max(500), itemId: z.string().uuid().optional(), limit: z.number().int().min(1).max(50).optional() }))
    .query(async ({ ctx, input }) => {
      const { embedder } = await backend(ctx.library).tools();
      const result = await searchLibrary(ctx.db, { ...input, embedder });
      return { ...result, hits: result.hits.map((h) => ({ ...h, thumbnailUrl: h.thumbnailAssetId ? ctx.media.urlFor(h.thumbnailAssetId) : null })) };
    }),

  voice: workspaceProcedure.query(({ ctx, input }) => voiceProfile(ctx.db, input.workspaceId)),

  chat: createTRPCRouter({
    history: workspaceProcedure.input(z.object({ itemId: z.string().uuid().nullish() })).query(async ({ ctx, input }) => {
      if (input.itemId) await getItem(ctx.db, input.workspaceId, input.itemId).catch(asTrpcError);
      const messages = await listLibraryMessages(ctx.db, input);
      const setup = ctx.chat ? await ctx.chat.load() : null;
      return { messages, writer: setup ? { label: setup.label, modelId: setup.modelId, problem: setup.problem } : null };
    }),

    send: workspaceProcedure
      .input(z.object({ itemId: z.string().uuid().nullish(), message: z.string().trim().min(1).max(2000) }))
      .mutation(async ({ ctx, input, signal }) => {
        const { writer } = await writerOf(ctx.chat);
        const library = backend(ctx.library);
        const { embedder } = await library.tools();
        const timed = timeLimit(signal, library.writing.timeoutMs);
        try {
          return await sendLibraryMessage(ctx.db, { ...input, writer, embedder, signal: timed.signal });
        } catch (error) {
          modelFailure(error, signal, writer.modelId, { ...timed, doing: "answer", next: "Try again, with a shorter question or a faster model." });
        }
      }),

    clear: workspaceProcedure.input(z.object({ itemId: z.string().uuid().nullish() })).mutation(async ({ ctx, input }) => {
      await clearLibraryMessages(ctx.db, input);
      return { cleared: true };
    }),
  }),

  ideas: createTRPCRouter({
    list: workspaceProcedure.input(z.object({ itemId: z.string().uuid().optional() })).query(({ ctx, input }) => listIdeas(ctx.db, input)),

    // "10 ideas in this style", "remix this hook", "a script for actor X",
    // "repurpose": idea cards, each a whole short script.
    generate: workspaceProcedure
      .input(
        z.object({
          kind: z.enum(IDEA_KINDS),
          itemIds: z.array(z.string().uuid()).max(10),
          count: z.number().int().min(1).max(10).optional(),
          actorId: z.string().uuid().nullish(),
          durationS: z.number().int().min(4).max(120).optional(),
          brief: z.string().trim().max(1000).nullish(),
          language: z.string().max(20).nullish(),
        }),
      )
      .mutation(async ({ ctx, input, signal }) => {
        const { writer, wordsPerSecond } = await writerOf(ctx.chat);
        const { writing } = backend(ctx.library);
        const defaults = { ideas: writing.ideas, remix: 5, script: 1, repurpose: 3 } as const;
        const timed = timeLimit(signal, writing.timeoutMs);
        try {
          return await generateIdeas(ctx.db, { ...input, count: input.count ?? defaults[input.kind], durationS: input.durationS ?? ideaSeconds(ctx.catalog), wordsPerSecond, writer, signal: timed.signal });
        } catch (error) {
          modelFailure(error, signal, writer.modelId, { ...timed, doing: input.kind === "script" ? "write the script" : "write the ideas", next: "Try again, or ask for fewer." });
        }
      }),

    createProject: workspaceProcedure
      .input(z.object({ ideaId: z.string().uuid(), actorId: z.string().uuid().nullish(), platform: PLATFORM.optional(), title: z.string().max(200).nullish(), modelKey: MODEL_KEY.nullish() }))
      .mutation(async ({ ctx, input }) => {
        if (input.modelKey && !ctx.catalog.models.some((m) => m.key === input.modelKey)) throw new TRPCError({ code: "BAD_REQUEST", message: `Unknown model "${input.modelKey}".` });
        return createProjectFromIdea(ctx.db, input).catch(asTrpcError);
      }),

    delete: workspaceProcedure.input(z.object({ ideaId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      await deleteIdea(ctx.db, input).catch(asTrpcError);
      return { deleted: true };
    }),
  }),
});
