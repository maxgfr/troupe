import { beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "~/test/db";
import { seedFixture, type Fixture } from "~/test/fixture";
import { testCaller } from "~/test/caller";
import { fakeEmbedder, fakeWriter } from "~/test/library";
import type { ChatBackend } from "~/modules/chat";
import type { AnalysisTools, LibraryBackend } from "~/modules/library";
import { runLibraryQueue } from "~/modules/library";
import type { Db } from "~/server/db/types";

const MEMBER = "73333333-3333-4333-8333-333333333333";
const STRANGER = "74444444-4444-4444-8444-444444444444";

let t: TestDb;
let db: Db;
let fx: Fixture;
let other: Fixture;

const chat: ChatBackend = {
  offers: ["ollama"],
  async load() {
    return { provider: "ollama", label: "Ollama", modelId: "fake-writer", model: fakeWriter(), problem: null, instructions: "", wordsPerSecond: 2.5 };
  },
  async settings() {
    throw new Error("unused");
  },
  async test() {
    return { ok: true, message: "" };
  },
};

const tools: AnalysisTools = {
  media: null,
  transcriber: { ready: false, problem: "No transcription here." },
  vision: { ready: false, problem: "No vision here." },
  embedder: { ready: true, tool: fakeEmbedder() },
  writer: { ready: true, tool: fakeWriter(), modelId: "fake-writer" },
};

let scheduled = 0;
const removed: string[][] = [];
const library = (extra: Partial<LibraryBackend> = {}): LibraryBackend => ({
  edition: "browser",
  async status() {
    return { edition: "browser", maxUploadBytes: 1, tools: [] };
  },
  async tools() {
    return tools;
  },
  schedule() {
    scheduled += 1;
  },
  async removeFiles(files) {
    removed.push(files.map((f) => f.storagePath));
  },
  ...extra,
});

const caller = (userId = MEMBER, backend: LibraryBackend | null = library()) => testCaller({ db, userId, chat, library: backend });

beforeAll(async () => {
  t = await createTestDb();
  db = t.db as unknown as Db;
  fx = await seedFixture(db, { userId: MEMBER, name: "Library router" });
  other = await seedFixture(db, { userId: STRANGER, name: "Stranger" });
});

describe("library router", () => {
  it("saves pasted text, schedules its analysis, then searches, chats and writes ideas that become a project", async () => {
    const before = scheduled;
    const item = await caller().library.addText({ workspaceId: fx.workspaceId, text: "Three ways to brew coffee at home without a machine." });
    expect(item).toMatchObject({ kind: "text", status: "queued", mediaUrl: null });
    expect(scheduled).toBe(before + 1);
    await runLibraryQueue(db, async () => tools);

    const found = await caller().library.search({ workspaceId: fx.workspaceId, query: "brew coffee at home" });
    expect(found.mode).toBe("semantic");
    expect(found.hits[0]).toMatchObject({ itemId: item.id, thumbnailUrl: null });

    const answer = await caller().library.chat.send({ workspaceId: fx.workspaceId, message: "What does it suggest?" });
    expect(answer.assistant.citations[0]).toMatchObject({ itemId: item.id });
    expect((await caller().library.chat.history({ workspaceId: fx.workspaceId })).messages).toHaveLength(2);

    const ideas = await caller().library.ideas.generate({ workspaceId: fx.workspaceId, kind: "ideas", itemIds: [item.id], count: 3 });
    expect(ideas).toHaveLength(3);
    const { projectId } = await caller().library.ideas.createProject({ workspaceId: fx.workspaceId, ideaId: ideas[1]!.id, platform: "youtube" });
    const project = await caller().studio.getProject({ projectId });
    expect(project).toMatchObject({ title: "Idea 2", platform: "youtube", format: "16:9" });
    expect((await caller().library.ideas.list({ workspaceId: fx.workspaceId, itemId: item.id }))[1]!.projectId).toBe(projectId);
  });

  it("keeps other workspaces out", async () => {
    const item = await caller().library.addText({ workspaceId: fx.workspaceId, text: "Private note." });
    await expect(caller(STRANGER).library.list({ workspaceId: fx.workspaceId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(STRANGER).library.get({ workspaceId: other.workspaceId, itemId: item.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller(STRANGER).library.delete({ workspaceId: other.workspaceId, itemId: item.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller(STRANGER).library.ideas.generate({ workspaceId: other.workspaceId, kind: "remix", itemIds: [item.id] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller(STRANGER).library.chat.history({ workspaceId: other.workspaceId, itemId: item.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await caller(STRANGER).library.list({ workspaceId: other.workspaceId })).toEqual([]);
  });

  it("says a browser cannot fetch links, and that the library is off where there is none", async () => {
    await expect(caller().library.addUrl({ workspaceId: fx.workspaceId, url: "https://example.com/post" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("cannot fetch other sites") });
    await expect(caller(MEMBER, null).library.status()).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "The inspiration library is not available in this studio." });
  });

  it("records an upload the edition stored, and removes its files with the item", async () => {
    const uploadId = crypto.randomUUID();
    const backend = library({
      async claimUpload(id) {
        return { assetId: crypto.randomUUID(), storagePath: `library/${id}/original.mp4`, mimeType: "video/mp4", bytes: 10, checksum: "x", fileName: "clip.mp4" };
      },
    });
    const item = await caller(MEMBER, backend).library.addUpload({ workspaceId: fx.workspaceId, uploadId, mine: true });
    expect(item).toMatchObject({ id: uploadId, kind: "video", title: "clip", mine: true, mediaUrl: `/api/media/${item.assetId}` });
    await caller(MEMBER, backend).library.delete({ workspaceId: fx.workspaceId, itemId: item.id });
    expect(removed.at(-1)).toEqual([`library/${uploadId}/original.mp4`]);
  });
});
