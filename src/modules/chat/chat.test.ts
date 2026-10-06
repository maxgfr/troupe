import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";

import { createTestDb, resetAuth, setAuthUser, type TestDb } from "~/test/db";
import { seedFixture, type Fixture } from "~/test/fixture";
import * as schema from "~/server/db/schema";
import type { Db } from "~/server/db/types";
import { listActors } from "~/modules/actors";
import { getScriptHistory, pasteScript } from "~/modules/script";
import { projects } from "~/modules/studio";
import {
  applyChatProposal,
  chatMessages,
  getChatSettings,
  listChatMessages,
  saveChatSettings,
  sendChatMessage,
  type ChatModel,
  type ChatSetup,
  type ChatTurn,
} from "~/modules/chat";

const OWNER = "61111111-1111-4111-8111-111111111111";
const STRANGER = "62222222-2222-4222-8222-222222222222";

let t: TestDb;
let db: Db;
let f: Fixture;

beforeAll(async () => {
  t = await createTestDb();
  db = t.db as unknown as Db;
  await seedFixture(db, { userId: STRANGER, name: "Other" });
});

// Every test gets its own project, so none depends on another's messages.
beforeEach(async () => {
  f = await seedFixture(db, { userId: OWNER, name: "Chat" });
});

// A model that answers from a script and records what it was sent.
function scriptedModel(answers: string[]) {
  const calls: ChatTurn[][] = [];
  const model: ChatModel = {
    async propose(messages) {
      calls.push(messages);
      const text = answers[Math.min(calls.length - 1, answers.length - 1)]!;
      let proposal: unknown = null;
      try {
        proposal = JSON.parse(text);
      } catch {}
      return { text, proposal };
    },
  };
  return { model, calls };
}

function setupWith(model: ChatModel, overrides: Partial<ChatSetup> = {}): ChatSetup {
  return { provider: "ollama", label: "Ollama", modelId: "qwen3:4b", model, problem: null, instructions: "", wordsPerSecond: 2.5, sendTimeoutMs: 300_000, ...overrides };
}

const answer = (lines: { role: string; text: string; emotion: string }[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ summary: "Punchier hook, same call to action.", lines, actor: null, ...extra });

const GOOD = answer([
  { role: "hook", text: "Stop scrolling: your mornings just got easier.", emotion: "excited" },
  { role: "body", text: "One cup, ten seconds, no mess.", emotion: "calm" },
  { role: "cta", text: "Tap the link today.", emotion: "serious" },
]);

describe("sending a request", () => {
  it("stores the request and the model's proposal, made on the newest version", async () => {
    const { model, calls } = scriptedModel([GOOD]);
    const result = await sendChatMessage(db, { projectId: f.projectId, message: "Make the hook punchier", durationS: 8, setup: setupWith(model) });

    expect(calls).toHaveLength(1);
    expect(result.user).toMatchObject({ role: "user", content: "Make the hook punchier", baseScriptId: f.scriptId });
    expect(result.assistant).toMatchObject({ role: "assistant", content: "Punchier hook, same call to action.", baseScriptId: f.scriptId, provider: "ollama", model: "qwen3:4b" });
    expect(result.assistant.proposal?.lines.map((l) => [l.role, l.emotion])).toEqual([["hook", "excited"], ["body", "calm"], ["cta", "serious"]]);
    expect((await listChatMessages(db, f.projectId)).map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("tells the model the word budget, the current lines and the house style", async () => {
    const { model, calls } = scriptedModel([GOOD]);
    const first = await sendChatMessage(db, { projectId: f.projectId, message: "Punchier", durationS: 8, setup: setupWith(model) });
    await applyChatProposal(db, { projectId: f.projectId, messageId: first.assistant.id });
    await sendChatMessage(db, { projectId: f.projectId, message: "Shorter", durationS: 8, setup: setupWith(model, { instructions: "Never use exclamation marks.", wordsPerSecond: 2 }) });
    const system = calls[1]![0]!;
    expect(system.role).toBe("system");
    expect(system.content).toContain("within 16 words");
    expect(system.content).toContain("One cup, ten seconds, no mess.");
    expect(system.content).toContain("House style: Never use exclamation marks.");
    // Earlier turns come along: the previous request and the model's summary.
    expect(calls[1]!.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(calls[1]!.at(-1)!.content).toBe("Shorter");
  });

  it("builds a follow-up on the newest proposal not applied yet, until it is applied", async () => {
    const { model, calls } = scriptedModel([GOOD]);
    await sendChatMessage(db, { projectId: f.projectId, message: "Punchier", durationS: 8, setup: setupWith(model) });
    expect(calls[0]![0]!.content).not.toContain("not applied yet");

    const followUp = await sendChatMessage(db, { projectId: f.projectId, message: "Now make that warmer", durationS: 8, setup: setupWith(model) });
    const system = calls[1]![0]!.content;
    expect(system).toContain("Your last proposal, not applied yet");
    expect(system).toContain("Stop scrolling: your mornings just got easier.");
    expect(system).toContain("Hook line. Body line. Call to action now.");
    // The diff still reads against the version the user has.
    expect(followUp.assistant.baseScriptId).toBe(f.scriptId);

    await applyChatProposal(db, { projectId: f.projectId, messageId: followUp.assistant.id });
    await sendChatMessage(db, { projectId: f.projectId, message: "Shorter", durationS: 8, setup: setupWith(model) });
    expect(calls[2]![0]!.content).not.toContain("not applied yet");
  });

  it("forgets a pending proposal once the script moved on without it", async () => {
    const { model, calls } = scriptedModel([GOOD]);
    await sendChatMessage(db, { projectId: f.projectId, message: "Punchier", durationS: 8, setup: setupWith(model) });
    await pasteScript(db, { projectId: f.projectId, text: "A line written by hand." });
    await sendChatMessage(db, { projectId: f.projectId, message: "Shorter", durationS: 8, setup: setupWith(model) });
    expect(calls[1]![0]!.content).not.toContain("not applied yet");
  });

  it("asks once more when the answer does not follow the format, then keeps the good one", async () => {
    const { model, calls } = scriptedModel(['{"summary": "Done", "lines": []}', GOOD]);
    const result = await sendChatMessage(db, { projectId: f.projectId, message: "Again", durationS: 8, setup: setupWith(model) });
    expect(calls).toHaveLength(2);
    const repair = calls[1]!;
    expect(repair.at(-2)).toEqual({ role: "assistant", content: '{"summary": "Done", "lines": []}' });
    expect(repair.at(-1)!.content).toMatch(/cannot be used: the script has no lines/);
    expect(result.assistant.proposal?.lines).toHaveLength(3);
  });

  it("keeps the raw answer, with no proposal, when the repair fails too", async () => {
    const { model, calls } = scriptedModel(["Sure! Here is a better hook: Wake up happy."]);
    const result = await sendChatMessage(db, { projectId: f.projectId, message: "Hook?", durationS: 8, setup: setupWith(model) });
    expect(calls).toHaveLength(2);
    expect(result.assistant.proposal).toBeNull();
    expect(result.assistant.content).toBe("Sure! Here is a better hook: Wake up happy.");
  });

  it("asks for shorter lines over the word budget, and keeps an over-long proposal rather than nothing", async () => {
    const long = answer([{ role: "hook", text: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one", emotion: "neutral" }]);
    const { model, calls } = scriptedModel([long, long]);
    const result = await sendChatMessage(db, { projectId: f.projectId, message: "Longer", durationS: 8, setup: setupWith(model) });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.at(-1)!.content).toMatch(/21 words.*20/);
    expect(result.assistant.proposal?.lines).toHaveLength(1);
  });

  it("refuses an actor that does not exist, and resolves one that does", async () => {
    const actors = await listActors(db, {});
    const other = actors.find((a) => a.id !== f.actorId && a.status === "active")!;
    const { model } = scriptedModel([answer([{ role: "hook", text: "Hi.", emotion: "happy" }], { actor: "Nobody" }), answer([{ role: "hook", text: "Hi.", emotion: "happy" }], { actor: other.name })]);
    const result = await sendChatMessage(db, { projectId: f.projectId, message: `Use ${other.name}`, durationS: 8, setup: setupWith(model) });
    expect(result.assistant.proposal?.actorId).toBe(other.id);
  });

  it("refuses to run without a model, saying why", async () => {
    await expect(sendChatMessage(db, { projectId: f.projectId, message: "Hi", durationS: 8, setup: setupWith(scriptedModel([GOOD]).model, { model: null, problem: "Ollama is not set up." }) })).rejects.toThrow("Ollama is not set up.");
  });
});

describe("applying a proposal", () => {
  it("adds a script version from the chat that keeps every role and emotion, once", async () => {
    const { model } = scriptedModel([GOOD]);
    const { assistant } = await sendChatMessage(db, { projectId: f.projectId, message: "Apply me", durationS: 8, setup: setupWith(model) });
    const before = await getScriptHistory(db, f.projectId);

    const applied = await applyChatProposal(db, { projectId: f.projectId, messageId: assistant.id });
    expect(applied.script).toMatchObject({ origin: "chat", version: before.at(-1)!.version + 1 });
    expect(applied.script.lines.map(({ role, text, emotion }) => ({ role, text, emotion }))).toEqual(assistant.proposal!.lines);

    // A second Apply (another tab, a double click) returns the same version.
    const again = await applyChatProposal(db, { projectId: f.projectId, messageId: assistant.id });
    expect(again.script.id).toBe(applied.script.id);
    expect(await getScriptHistory(db, f.projectId)).toHaveLength(before.length + 1);
    const [stored] = await db.select().from(chatMessages).where(eq(chatMessages.id, assistant.id));
    expect(stored!.appliedScriptId).toBe(applied.script.id);
  });

  it("changes the project's actor when the proposal names another one", async () => {
    const actors = await listActors(db, {});
    const other = actors.find((a) => a.id !== f.actorId && a.status === "active")!;
    const { model } = scriptedModel([answer([{ role: "hook", text: "New face, same coffee.", emotion: "happy" }], { actor: other.name })]);
    const { assistant } = await sendChatMessage(db, { projectId: f.projectId, message: "Switch actor", durationS: 8, setup: setupWith(model) });
    const applied = await applyChatProposal(db, { projectId: f.projectId, messageId: assistant.id });
    expect(applied.actorChanged).toBe(true);
    const [project] = await db.select().from(projects).where(eq(projects.id, f.projectId));
    expect(project!.actorId).toBe(other.id);
  });

  it("refuses a message that holds no proposal, or belongs to another project", async () => {
    const { model } = scriptedModel(["not json"]);
    const { user, assistant } = await sendChatMessage(db, { projectId: f.projectId, message: "x", durationS: 8, setup: setupWith(model) });
    await expect(applyChatProposal(db, { projectId: f.projectId, messageId: assistant.id })).rejects.toThrow(/no script to apply/i);
    await expect(applyChatProposal(db, { projectId: f.projectId, messageId: user.id })).rejects.toThrow(/no script to apply/i);
    const other = await seedFixture(db, { userId: "63333333-3333-4333-8333-333333333333", name: "Third" });
    await expect(applyChatProposal(db, { projectId: other.projectId, messageId: assistant.id })).rejects.toThrow(/not found/i);
  });
});

describe("against an emotion retag in place", () => {
  // The same database, with every statement written down.
  function logged() {
    const queries: string[] = [];
    const conn = drizzle(t.pg, { schema, logger: { logQuery: (query) => void queries.push(query) } }) as unknown as Db;
    return { conn, queries };
  }
  const shareLockOn = (queries: string[]) => queries.findIndex((q) => /^select .* from "troupe_script" where "troupe_script"\."id" = \$1 for share$/.test(q));

  it("records a request under a share lock on the version it was made on", async () => {
    const { conn, queries } = logged();
    const { model } = scriptedModel([GOOD]);
    await sendChatMessage(conn, { projectId: f.projectId, message: "Sharper", durationS: 8, setup: setupWith(model) });
    const lock = shareLockOn(queries);
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(queries.findIndex((q) => q.startsWith('insert into "troupe_chat_message"')));
  });

  it("applies a proposal under a share lock on the version it was made on", async () => {
    const { model } = scriptedModel([GOOD]);
    const { assistant } = await sendChatMessage(db, { projectId: f.projectId, message: "Sharper", durationS: 8, setup: setupWith(model) });
    const { conn, queries } = logged();
    await applyChatProposal(conn, { projectId: f.projectId, messageId: assistant.id });
    const lock = shareLockOn(queries);
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(queries.findIndex((q) => q.startsWith('insert into "troupe_script"')));
  });
});

describe("row-level security", () => {
  it("shows a project's chat to its workspace members only", async () => {
    await sendChatMessage(db, { projectId: f.projectId, message: "Hi", durationS: 8, setup: setupWith(scriptedModel([GOOD]).model) });
    await setAuthUser(t, OWNER);
    const mine = await t.pg.query("select id from troupe_chat_message");
    await setAuthUser(t, STRANGER);
    const theirs = await t.pg.query("select id from troupe_chat_message");
    await resetAuth(t);
    expect(mine.rows.length).toBeGreaterThan(0);
    expect(theirs.rows).toHaveLength(0);
  });
});

describe("chat settings", () => {
  it("saves, merges and clears studio-wide preferences, ignoring unreadable stored values", async () => {
    expect(await getChatSettings(db)).toEqual({});
    await saveChatSettings(db, { provider: "ollama", ollamaModel: "llama3.2:3b", wordsPerSecond: 2.2 });
    await saveChatSettings(db, { instructions: "Warm, no slang." });
    expect(await getChatSettings(db)).toEqual({ provider: "ollama", ollamaModel: "llama3.2:3b", wordsPerSecond: 2.2, instructions: "Warm, no slang." });
    // null clears a value: the default applies again.
    await saveChatSettings(db, { ollamaModel: null });
    expect(await getChatSettings(db)).not.toHaveProperty("ollamaModel");
    await expect(saveChatSettings(db, { wordsPerSecond: 0 })).rejects.toThrow();
    await t.pg.exec(`update troupe_studio_settings set chat = '{"provider": "gpt", "wordsPerSecond": 2.2}'`);
    expect(await getChatSettings(db)).toEqual({ wordsPerSecond: 2.2 });
  });
});
