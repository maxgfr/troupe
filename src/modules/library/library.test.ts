import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestDb, resetAuth, setAuthUser, type TestDb } from "~/test/db";
import { seedFixture } from "~/test/fixture";
import type { ChatTurn } from "~/modules/chat";
import { fakeEmbedder, fakeWriter } from "~/test/library";
import { mediaAssets } from "~/modules/generation";
import { getScriptHistory } from "~/modules/script";
import { getProject } from "~/modules/studio";
import {
  addFileItem,
  addTextItem,
  analyzeItem,
  claimNextItem,
  createProjectFromIdea,
  deleteItem,
  generateIdeas,
  getItem,
  libraryChunks,
  libraryItems,
  listItems,
  requeueItem,
  requeueStale,
  runLibraryQueue,
  thumbnailOf,
  searchLibrary,
  sendLibraryMessage,
  updateItem,
  voiceProfile,
  type AnalysisTools,
  type MediaReader,
} from "./index";

function fakeMedia(t: TestDb, workspaceId: string): MediaReader {
  return {
    async probe() {
      return { durationS: 20, hasVideo: true, hasAudio: true };
    },
    async frames(item) {
      const frames = [];
      for (const atS of [0.5, 6, 12]) {
        const [asset] = await t.db.insert(mediaAssets).values({ workspaceId, kind: "frame", storagePath: `library/${item.itemId}/frame-${atS}.jpg`, mimeType: "image/jpeg", bytes: 10, checksum: "x", meta: { itemId: item.itemId, atS } }).returning();
        frames.push({ assetId: asset!.id, atS });
      }
      return { frames, cutsAtS: [6, 12] };
    },
    async audio() {
      return { kind: "file" as const, path: "/tmp/audio.flac" };
    },
    async picture() {
      return { bytes: new Uint8Array([1]), mimeType: "image/jpeg" };
    },
  };
}

function tools(t: TestDb, workspaceId: string, overrides: Partial<AnalysisTools> = {}): AnalysisTools {
  return {
    media: fakeMedia(t, workspaceId),
    transcriber: {
      ready: true,
      tool: {
        model: "fake-whisper",
        async transcribe() {
          return { language: "en", model: "fake-whisper", segments: [{ startS: 0, endS: 2, text: "Stop buying cold brew." }, { startS: 2, endS: 10, text: "Make it at home with a jar and coarse coffee overnight." }, { startS: 18, endS: 20, text: "Follow for more coffee tricks." }] };
        },
      },
    },
    vision: { ready: true, tool: { model: "fake-vision", async read() { return { description: "A barista holds a jar of coffee.", text: "COLD BREW HACK" }; } } },
    embedder: { ready: true, tool: fakeEmbedder() },
    writer: { ready: true, tool: fakeWriter(), modelId: "fake-writer", label: "Fake" },
    ...overrides,
  };
}

async function saveVideo(t: TestDb, workspaceId: string, title = "Cold brew trick") {
  const assetId = randomUUID();
  const itemId = randomUUID();
  return addFileItem(t.db, { workspaceId, itemId, title, file: { assetId, storagePath: `library/${itemId}/original.mp4`, mimeType: "video/mp4", bytes: 1000, checksum: "abc", fileName: "cold-brew.mp4" } });
}

describe("the inspiration library", () => {
  let t: TestDb;
  let workspaceId: string;
  const userId = randomUUID();

  beforeEach(async () => {
    t = await createTestDb();
    workspaceId = (await seedFixture(t.db, { userId, name: "Lib" })).workspaceId;
  });

  it("analyses a video: frames, transcript, what the pictures show, hook, structure, pacing, tags and search passages", async () => {
    const item = await saveVideo(t, workspaceId);
    expect(item).toMatchObject({ kind: "video", status: "queued", title: "Cold brew trick", fileName: "cold-brew.mp4" });
    expect(await claimNextItem(t.db)).toBe(item.id);
    expect(await claimNextItem(t.db)).toBeNull();
    await analyzeItem(t.db, item.id, tools(t, workspaceId));

    const detail = await getItem(t.db, workspaceId, item.id);
    expect(detail.status).toBe("ready");
    expect(detail.problem).toBeNull();
    expect(detail.durationS).toBe(20);
    expect(detail.tags).toEqual(["coffee", "cold brew"]);
    const a = detail.analysis!;
    expect(a.hook).toEqual({ text: "Stop buying cold brew.", endS: 3, why: "It opens on a bold claim." });
    expect(a.frames).toHaveLength(3);
    expect(a.frames![0]).toMatchObject({ atS: 0.5, description: "A barista holds a jar of coffee.", text: "COLD BREW HACK" });
    expect(a.structure).toEqual([{ part: "hook", startS: 0, summary: "Bold claim" }, { part: "cta", startS: 18, summary: "Follow" }]);
    expect(a.tone).toEqual(["playful", "direct"]);
    expect(a.pacing).toMatchObject({ cutsPerMinute: 6 });
    expect(a.insightsModel).toBe("fake-writer");
    expect(a.steps.map((s) => `${s.name}:${s.status}`)).toEqual(["frames:done", "transcript:done", "vision:done", "insights:done", "embeddings:done"]);
    // Every frame weighs the same here: the first is the thumbnail.
    expect(detail.thumbnailAssetId).toBe(a.frames![0]!.assetId);
    expect(detail.passages).toBeGreaterThanOrEqual(5);
    expect(detail.embedded).toBe(detail.passages);
  });

  it("skips what a missing tool would do, says why, and is still searchable by keywords", async () => {
    const item = await saveVideo(t, workspaceId);
    await claimNextItem(t.db);
    await analyzeItem(t.db, item.id, tools(t, workspaceId, {
      vision: { ready: false, problem: "Pull the vision model." },
      embedder: { ready: false, problem: "Pull the embedding model." },
      writer: { ready: false, problem: "No chat model is set up." },
    }));
    const detail = await getItem(t.db, workspaceId, item.id);
    expect(detail.status).toBe("ready");
    expect(detail.problem).toBe("Skipped: what the pictures show. Pull the vision model. Skipped: the hook, structure and tags. No chat model is set up. Skipped: search by meaning. Pull the embedding model.");
    expect(detail.tags).toContain("coffee");
    expect(detail.analysis!.structure).toEqual([{ part: "hook", startS: 0, summary: "Stop buying cold brew." }, { part: "cta", startS: 18, summary: "Follow for more coffee tricks." }]);
    const found = await searchLibrary(t.db, { workspaceId, query: "jar overnight", embedder: { ready: false, problem: "Pull the embedding model." } });
    expect(found.mode).toBe("keyword");
    expect(found.note).toBe("Pull the embedding model.");
    expect(found.hits[0]).toMatchObject({ itemId: item.id, startS: 0 });

    // Once the model is there, the queue indexes what it missed.
    expect(await runLibraryQueue(t.db, async () => tools(t, workspaceId))).toBe(0);
    expect((await getItem(t.db, workspaceId, item.id)).embedded).toBe(detail.passages);
    expect((await searchLibrary(t.db, { workspaceId, query: "jar overnight", embedder: { ready: true, tool: fakeEmbedder() } })).mode).toBe("semantic");
  });

  it("fails an item whose file cannot be read, with the reason, and retries one cut short", async () => {
    const item = await saveVideo(t, workspaceId);
    await claimNextItem(t.db);
    await analyzeItem(t.db, item.id, tools(t, workspaceId, { media: { ...fakeMedia(t, workspaceId), probe: async () => { throw new Error("ffprobe: invalid data"); } } }));
    expect(await getItem(t.db, workspaceId, item.id)).toMatchObject({ status: "failed", problem: "ffprobe: invalid data" });

    const other = await saveVideo(t, workspaceId, "Second");
    await claimNextItem(t.db);
    await t.db.update(libraryItems).set({ heartbeatAt: new Date(Date.now() - 60 * 60_000) }).where(eq(libraryItems.id, other.id));
    expect(await requeueStale(t.db, 30 * 60_000)).toBe(1);
    expect((await getItem(t.db, workspaceId, other.id)).status).toBe("queued");
  });

  it("retries an analysis whose heartbeat stopped, never one still running elsewhere, and fails it after three tries", async () => {
    const item = await saveVideo(t, workspaceId);
    const stopBeating = () => t.db.update(libraryItems).set({ heartbeatAt: new Date(Date.now() - 10 * 60_000) }).where(eq(libraryItems.id, item.id));
    for (const attempt of [1, 2, 3]) {
      expect(await claimNextItem(t.db)).toBe(item.id);
      // Another process (a second replica, a second tab) is analysing it.
      expect(await requeueStale(t.db, 5 * 60_000)).toBe(0);
      await stopBeating();
      expect(await requeueStale(t.db, 5 * 60_000)).toBe(1);
      const [row] = await t.db.select().from(libraryItems).where(eq(libraryItems.id, item.id));
      expect(row).toMatchObject({ attempts: attempt, status: attempt < 3 ? "queued" : "failed" });
    }
    expect((await getItem(t.db, workspaceId, item.id)).problem).toMatch(/stopped 3 times before it finished/);
    // "Read it again" starts the count over.
    await requeueItem(t.db, { workspaceId, itemId: item.id });
    expect((await t.db.select().from(libraryItems).where(eq(libraryItems.id, item.id)))[0]).toMatchObject({ status: "queued", attempts: 0 });
  });

  it("stops analysing an item deleted meanwhile, and leaves none of its pictures behind", async () => {
    const item = await saveVideo(t, workspaceId);
    await claimNextItem(t.db);
    const removed: string[] = [];
    let deleted!: () => void;
    const afterDelete = new Promise<void>((resolve) => (deleted = resolve));
    let picturesTaken!: () => void;
    const taking = new Promise<void>((resolve) => (picturesTaken = resolve));
    const media: MediaReader = {
      ...fakeMedia(t, workspaceId),
      async frames(file) {
        const frame = async (atS: number) => (await t.db.insert(mediaAssets).values({ workspaceId, kind: "frame", storagePath: `library/${file.itemId}/frame-${atS}.jpg`, mimeType: "image/jpeg", bytes: 10, checksum: "x", meta: { itemId: file.itemId, atS } }).returning())[0]!;
        const first = await frame(0);
        picturesTaken();
        await afterDelete;
        // A picture written after the item's files were listed for deletion.
        const late = await frame(6);
        return { frames: [first, late].map((f, i) => ({ assetId: f.id, atS: i * 6 })), cutsAtS: [6] };
      },
    };
    let transcribing: AbortSignal | undefined;
    const running = analyzeItem(t.db, item.id, tools(t, workspaceId, { media, transcriber: { ready: true, tool: { model: "w", transcribe: async (_audio, options) => { transcribing = options.signal; return { language: "en", model: "w", segments: [] }; } } } }), {
      removeFiles: async (files) => {
        removed.push(...files.map((f) => f.storagePath));
      },
    });
    await taking;
    await deleteItem(t.db, { workspaceId, itemId: item.id });
    deleted();
    await running;
    expect(transcribing).toBeUndefined();
    expect(await t.db.select().from(mediaAssets).where(sql`${mediaAssets.meta}->>'itemId' = ${item.id}`)).toEqual([]);
    expect(removed).toEqual([`library/${item.id}/frame-6.jpg`]);
  });

  it("aborts the running step at once when its item is deleted in this process", async () => {
    const item = await saveVideo(t, workspaceId);
    await claimNextItem(t.db);
    let started!: () => void;
    const transcribing = new Promise<void>((resolve) => (started = resolve));
    let stopped = false;
    const transcriber = {
      ready: true as const,
      tool: {
        model: "w",
        transcribe: (_audio: unknown, options: { signal?: AbortSignal }) =>
          new Promise<never>((_resolve, reject) => {
            started();
            options.signal?.addEventListener("abort", () => {
              stopped = true;
              reject(new Error("stopped"));
            });
          }),
      },
    };
    const running = analyzeItem(t.db, item.id, tools(t, workspaceId, { transcriber }));
    await transcribing;
    await deleteItem(t.db, { workspaceId, itemId: item.id });
    await running;
    expect(stopped).toBe(true);
  });

  it("saves pasted text, analyses it without media tools and finds it by meaning", async () => {
    const note = await addTextItem(t.db, { workspaceId, text: "Most people get mornings wrong.\n\nWake up, drink water, then walk ten minutes before any screen." });
    expect(note).toMatchObject({ kind: "text", title: "Most people get mornings wrong.", status: "queued" });
    await expect(addTextItem(t.db, { workspaceId, text: "   " })).rejects.toThrow("The text is empty.");
    await runLibraryQueue(t.db, async () => tools(t, workspaceId, { media: null }));
    const detail = await getItem(t.db, workspaceId, note.id);
    expect(detail.status).toBe("ready");
    expect(detail.analysis!.hook?.text).toBe("Most people get mornings wrong.");
    const found = await searchLibrary(t.db, { workspaceId, query: "morning walk before screens", embedder: { ready: true, tool: fakeEmbedder() } });
    expect(found.mode).toBe("semantic");
    expect(found.hits[0]!.itemId).toBe(note.id);
  });

  it("answers from the library with citations to items and times", async () => {
    const item = await saveVideo(t, workspaceId);
    await runLibraryQueue(t.db, async () => tools(t, workspaceId));
    const seen: ChatTurn[][] = [];
    const { user, assistant } = await sendLibraryMessage(t.db, { workspaceId, message: "How does the cold brew video open?", writer: { model: fakeWriter(seen), provider: "ollama", modelId: "fake-writer" }, embedder: { ready: true, tool: fakeEmbedder() } });
    expect(user).toMatchObject({ role: "user", itemId: null });
    expect(assistant.content).toBe("It opens on a bold claim about coffee [1].");
    expect(assistant.citations).toHaveLength(1);
    expect(assistant.citations[0]).toMatchObject({ n: 1, itemId: item.id, title: "Cold brew trick", kind: "video" });
    expect(seen[0]![0]!.content).toContain('[1] "Cold brew trick"');

    // Chat with one item: the whole (short) item is the source.
    const one = await sendLibraryMessage(t.db, { workspaceId, itemId: item.id, message: "Summarise it", writer: { model: fakeWriter(seen), provider: "ollama", modelId: "fake-writer" }, embedder: { ready: true, tool: fakeEmbedder() } });
    expect(one.assistant.itemId).toBe(item.id);
    expect(seen[1]![0]!.content).toContain("one piece they saved");
  });

  it("writes idea cards in the style of an item, in my voice, and makes a project with the script in one click", async () => {
    const item = await saveVideo(t, workspaceId);
    const mine = await addTextItem(t.db, { workspaceId, text: "Your desk is lying to you. Fix the light first.", mine: true });
    await runLibraryQueue(t.db, async () => tools(t, workspaceId));
    expect((await voiceProfile(t.db, workspaceId)).profile).toContain("From 1 of your own piece.");
    expect(mine.mine).toBe(true);

    const seen: ChatTurn[][] = [];
    const ideas = await generateIdeas(t.db, { workspaceId, kind: "ideas", itemIds: [item.id], count: 10, durationS: 20, wordsPerSecond: 2.5, writer: { model: fakeWriter(seen), provider: "ollama", modelId: "fake-writer" } });
    expect(ideas).toHaveLength(3);
    expect(ideas[0]).toMatchObject({ title: "Idea 1", hook: "Hook 1?", language: "en", itemIds: [item.id], kind: "ideas" });
    expect(ideas[0]!.lines.map((l) => l.role)).toEqual(["hook", "body", "cta"]);
    expect(ideas[0]!.lines[1]!.text).toBe("Middle line.");
    expect(seen[0]![0]!.content).toContain("Write in the creator's own voice");
    expect(seen[0]![0]!.content).toContain("at most 50 words");

    const { projectId, created } = await createProjectFromIdea(t.db, { workspaceId, ideaId: ideas[0]!.id });
    expect(created).toBe(true);
    expect(await getProject(t.db, projectId)).toMatchObject({ title: "Idea 1", platform: "tiktok", format: "9:16", language: "en", status: "scripting" });
    const [script] = await getScriptHistory(t.db, projectId);
    expect(script).toMatchObject({ version: 1, origin: "chat" });
    expect(script!.lines.map((l) => l.text)).toEqual(["Hook 1?", "Middle line.", "Follow for more."]);
    expect(await createProjectFromIdea(t.db, { workspaceId, ideaId: ideas[0]!.id })).toEqual({ projectId, created: false });
  });

  it("refuses ideas from an item still being analysed", async () => {
    const item = await saveVideo(t, workspaceId);
    await expect(generateIdeas(t.db, { workspaceId, kind: "remix", itemIds: [item.id], count: 3, durationS: 20, wordsPerSecond: 2.5, writer: { model: fakeWriter(), provider: "ollama", modelId: "w" } })).rejects.toThrow("is not analysed yet");
  });

  it("deletes an item with its passages and hands back its files", async () => {
    const item = await saveVideo(t, workspaceId);
    await runLibraryQueue(t.db, async () => tools(t, workspaceId));
    const { files } = await deleteItem(t.db, { workspaceId, itemId: item.id });
    expect(files.map((f) => f.storagePath).sort()).toEqual([`library/${item.id}/frame-0.5.jpg`, `library/${item.id}/frame-12.jpg`, `library/${item.id}/frame-6.jpg`, `library/${item.id}/original.mp4`].sort());
    expect(await t.db.select().from(libraryChunks).where(eq(libraryChunks.itemId, item.id))).toEqual([]);
    expect(await listItems(t.db, { workspaceId })).toEqual([]);
  });

  it("keeps each workspace's library to itself, in the service and under row level security", async () => {
    const item = await saveVideo(t, workspaceId);
    await runLibraryQueue(t.db, async () => tools(t, workspaceId));
    const stranger = randomUUID();
    const other = (await seedFixture(t.db, { userId: stranger, name: "Other" })).workspaceId;
    await expect(getItem(t.db, other, item.id)).rejects.toThrow("not in your library");
    await expect(updateItem(t.db, { workspaceId: other, itemId: item.id, mine: true })).rejects.toThrow("not in your library");
    expect((await searchLibrary(t.db, { workspaceId: other, query: "coffee", embedder: { ready: false, problem: "" } })).hits).toEqual([]);

    await setAuthUser(t, stranger);
    expect(await t.db.select().from(libraryItems)).toEqual([]);
    expect(await t.db.select().from(libraryChunks)).toEqual([]);
    await setAuthUser(t, userId);
    expect(await t.db.select({ id: libraryItems.id }).from(libraryItems)).toEqual([{ id: item.id }]);
    await resetAuth(t);
  });

  it("does not take a black opening frame as the thumbnail", async () => {
    const item = await saveVideo(t, workspaceId);
    const [black, shot, other] = await t.db.insert(mediaAssets).values([1200, 24_000, 21_000].map((bytes, i) => ({ workspaceId, kind: "frame" as const, storagePath: `library/${item.id}/f${i}.jpg`, mimeType: "image/jpeg", bytes, checksum: "x", meta: { itemId: item.id } }))).returning();
    expect(await thumbnailOf(t.db, [black!, shot!, other!].map((f, i) => ({ assetId: f.id, atS: i })))).toBe(shot!.id);
  });

  it("keeps the complete ideas of an answer cut off by the token limit, without asking again", async () => {
    const item = await addTextItem(t.db, { workspaceId, text: "Stop buying cold brew. Make it at home overnight." });
    await runLibraryQueue(t.db, async () => tools(t, workspaceId, { media: null }));
    const cut = '{"ideas": [{"title": "Jar test", "hook": "Got a jar?", "lines": [{"role": "hook", "text": "Got a jar?", "emotion": "excited"}, {"role": "cta", "text": "Try it tonight.", "emotion": "happy"}]}, {"title": "Half';
    const seen: ChatTurn[][] = [];
    const truncating = { async propose(messages: ChatTurn[]) { seen.push(messages); return { text: cut, proposal: null }; } };
    const ideas = await generateIdeas(t.db, { workspaceId, kind: "ideas", itemIds: [item.id], count: 3, durationS: 20, wordsPerSecond: 2.5, writer: { model: truncating, provider: "ollama", modelId: "tiny" } });
    expect(ideas.map((i) => i.title)).toEqual(["Jar test"]);
    // One answer was enough: a second would have cost another full answer's time.
    expect(seen).toHaveLength(1);
  });

  it("asks again with the problem when a cut-off answer holds no complete idea", async () => {
    const item = await addTextItem(t.db, { workspaceId, text: "Stop buying cold brew. Make it at home overnight." });
    await runLibraryQueue(t.db, async () => tools(t, workspaceId, { media: null }));
    const seen: ChatTurn[][] = [];
    const truncating = { async propose(messages: ChatTurn[]) { seen.push(messages); return { text: '{"ideas": [{"title": "Half', proposal: null }; } };
    await expect(generateIdeas(t.db, { workspaceId, kind: "ideas", itemIds: [item.id], count: 3, durationS: 20, wordsPerSecond: 2.5, writer: { model: truncating, provider: "ollama", modelId: "tiny" } })).rejects.toThrow("did not write usable scripts");
    expect(seen).toHaveLength(2);
    expect(seen[1]!.at(-1)!.content).toContain('"ideas" must hold 3 different items');
  });

  it("bounds each answer by the clip's word budget", async () => {
    const item = await addTextItem(t.db, { workspaceId, text: "Stop buying cold brew. Make it at home overnight." });
    await runLibraryQueue(t.db, async () => tools(t, workspaceId, { media: null }));
    const limits: (number | undefined)[] = [];
    const writer = fakeWriter();
    const counting = { async propose(messages: ChatTurn[], options: Parameters<typeof writer.propose>[1]) { limits.push(options.maxTokens); return writer.propose(messages, options); } };
    await generateIdeas(t.db, { workspaceId, kind: "ideas", itemIds: [item.id], count: 3, durationS: 15, wordsPerSecond: 2.5, writer: { model: counting, provider: "ollama", modelId: "tiny" } });
    // 37 words a script: 110 + 52 tokens an idea, and 200 for the rest.
    expect(limits).toEqual([686]);
  });

  it("keeps the ideas it has when the time runs out while asking for shorter ones", async () => {
    const item = await addTextItem(t.db, { workspaceId, text: "Stop buying cold brew. Make it at home overnight." });
    await runLibraryQueue(t.db, async () => tools(t, workspaceId, { media: null }));
    const long = (title: string) => ({ title, hook: "Hook?", lines: Array.from({ length: 6 }, () => ({ role: "body", text: Array.from({ length: 20 }, () => "word").join(" "), emotion: "calm" })) });
    let calls = 0;
    const slow = {
      async propose(_messages: ChatTurn[], options: { signal?: AbortSignal }) {
        calls += 1;
        if (calls === 1) {
          const answer = { ideas: [long("Long one"), long("Long two")] };
          return { text: JSON.stringify(answer), proposal: answer };
        }
        // The shorter ask never ends on its own.
        return new Promise<never>((_resolve, reject) => options.signal?.addEventListener("abort", () => reject(options.signal!.reason)));
      },
    };
    const started = Date.now();
    const ideas = await generateIdeas(t.db, { workspaceId, kind: "ideas", itemIds: [item.id], count: 2, durationS: 20, wordsPerSecond: 2.5, writer: { model: slow, provider: "ollama", modelId: "tiny" }, signal: AbortSignal.timeout(300) });
    expect(ideas.map((i) => i.title)).toEqual(["Long one", "Long two"]);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("gives the analysis's writing a time limit, and the item is still read", async () => {
    const item = await addTextItem(t.db, { workspaceId, text: "Stop buying cold brew. Make it at home overnight." });
    const hanging = { async propose(_messages: ChatTurn[], options: { signal?: AbortSignal }) { return new Promise<never>((_resolve, reject) => options.signal?.addEventListener("abort", () => reject(options.signal!.reason))); } };
    await runLibraryQueue(t.db, async () => tools(t, workspaceId, { media: null, writer: { ready: true, tool: hanging, modelId: "tiny", label: "Tiny" } }), { writeTimeoutMs: 200 });
    const detail = await getItem(t.db, workspaceId, item.id);
    expect(detail.status).toBe("ready");
    expect(detail.problem).toMatch(/Failed: the hook, structure and tags\. tiny took longer than 1 s to write the analysis/);
    expect(detail.embedded).toBeGreaterThan(0);
  });

  it("asks again when every idea is far over the clip's word budget, and lists the ones that fit first", async () => {
    const item = await addTextItem(t.db, { workspaceId, text: "Stop buying cold brew. Make it at home overnight." });
    await runLibraryQueue(t.db, async () => tools(t, workspaceId, { media: null }));
    // Scripts of `words` words, in lines of ten.
    const idea = (title: string, words: number) => ({ title, hook: "Hook?", lines: Array.from({ length: Math.ceil(words / 10) }, (_, i) => ({ role: i === 0 ? "hook" : "body", text: Array.from({ length: 10 }, () => "word").join(" "), emotion: "calm" })) });
    const answers = [{ ideas: [idea("Long", 120), idea("Longer", 140)] }, { ideas: [idea("Still long", 90), idea("Fits", 20)] }];
    const seen: ChatTurn[][] = [];
    const wordy = { async propose(messages: ChatTurn[]) { seen.push(messages); const a = answers.shift()!; return { text: JSON.stringify(a), proposal: a }; } };
    const ideas = await generateIdeas(t.db, { workspaceId, kind: "ideas", itemIds: [item.id], count: 2, durationS: 20, wordsPerSecond: 2.5, writer: { model: wordy, provider: "ollama", modelId: "tiny" } });
    expect(ideas.map((i) => i.title)).toEqual(["Fits", "Still long"]);
    expect(seen[1]!.at(-1)!.content).toContain("at most 50 words");
  });
});
