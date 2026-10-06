import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "~/test/db";
import { seedFixture, type Fixture } from "~/test/fixture";
import { testCaller } from "~/test/caller";
import { fakeAdapter } from "~/test/adapters";
import { json, startServer } from "~/test/local-server";
import { createServerChat } from "~/server/chat";
import { chatMessages, type ChatBackend } from "~/modules/chat";
import type { Db } from "~/server/db/types";

const MEMBER = "71111111-1111-4111-8111-111111111111";
const STRANGER = "72222222-2222-4222-8222-222222222222";

let t: TestDb;
let db: Db;
let fx: Fixture;
let ollama: Awaited<ReturnType<typeof startServer>>;
// What the fake Ollama answers next.
let reply: { status: number; body: unknown } = { status: 200, body: {} };

const PROPOSAL = {
  summary: "A sharper hook.",
  lines: [
    { role: "hook", text: "Wake up to better coffee.", emotion: "excited" },
    { role: "cta", text: "Order today.", emotion: "serious" },
  ],
  actor: null,
};

beforeAll(async () => {
  t = await createTestDb();
  db = t.db as unknown as Db;
  await seedFixture(db, { userId: STRANGER, name: "Stranger" });
  ollama = await startServer((req, res) => {
    if (req.path === "/api/tags") return json(res, 200, { models: [{ name: "qwen3:4b", model: "qwen3:4b" }] });
    json(res, reply.status, reply.body);
  });
});

afterAll(() => ollama.close());

// A project of its own for every test: none depends on another's messages.
beforeEach(async () => {
  fx = await seedFixture(db, { userId: MEMBER, name: "Chat router" });
  reply = { status: 200, body: { message: { role: "assistant", content: JSON.stringify(PROPOSAL) } } };
});

const chat = () => createServerChat(db, { env: { OLLAMA_URL: ollama.url, OLLAMA_MODEL: "qwen3:4b" } });
const asMember = (adapters = [fakeAdapter({ modelKey: "fake" })]) => testCaller({ db, userId: MEMBER, adapters, chat: chat() });

describe("chat router with Ollama", () => {
  it("sends the conversation to Ollama with the schema as its format, and stores the proposal", async () => {
    reply = { status: 200, body: { message: { role: "assistant", content: JSON.stringify(PROPOSAL) } } };
    const result = await asMember().chat.send({ projectId: fx.projectId, message: "Sharper hook", durationS: 8 });
    expect(result.assistant.proposal?.lines).toHaveLength(2);

    const sent = JSON.parse(ollama.requests.at(-1)!.body) as Record<string, unknown>;
    expect(ollama.requests.at(-1)!.path).toBe("/api/chat");
    expect(sent).toMatchObject({ model: "qwen3:4b", stream: false, think: false, format: { type: "object", required: ["summary", "lines", "actor"] } });
    expect((sent.messages as { role: string }[]).map((m) => m.role)).toEqual(["system", "user"]);

    const history = await asMember().chat.history({ projectId: fx.projectId });
    expect(history.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(history.provider).toMatchObject({ id: "ollama", label: "Ollama", modelId: "qwen3:4b", problem: null });
  });

  it("bounds the answer by the clip's seconds of speech, so a rambling model stops early", async () => {
    const tokens = async (durationS: number) => {
      await asMember().chat.send({ projectId: fx.projectId, message: "Sharper hook", durationS });
      return (JSON.parse(ollama.requests.at(-1)!.body) as { options: { num_predict?: number } }).options.num_predict;
    };
    // 300 for the summary, keys, roles and emotions, then 7 a second of speech
    // (Japanese, Chinese or Thai have no spaces to count words by), or 1.4 a
    // word of the budget when that is more.
    expect(await tokens(8)).toBe(300 + 56);
    expect(await tokens(20)).toBe(300 + 140);
  });

  it("stops an answer that takes longer than the time limit, both tries together, and says so", async () => {
    let stopped = 0;
    const hanging: ChatBackend = {
      ...chat(),
      async load() {
        return {
          provider: "ollama",
          label: "Ollama",
          modelId: "qwen2.5:0.5b",
          problem: null,
          instructions: "",
          wordsPerSecond: 2.5,
          sendTimeoutMs: 300,
          model: {
            propose: (_turns, options) =>
              new Promise<never>((_resolve, reject) =>
                options.signal?.addEventListener("abort", () => {
                  stopped += 1;
                  reject(options.signal!.reason);
                }),
              ),
          },
        };
      },
    };
    const started = Date.now();
    await expect(testCaller({ db, userId: MEMBER, chat: hanging }).chat.send({ projectId: fx.projectId, message: "Sharper hook", durationS: 8 })).rejects.toMatchObject({
      code: "TIMEOUT",
      message: "qwen2.5:0.5b took longer than 1 s to write a new version and was stopped. Try again, perhaps in fewer words.",
    });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(stopped).toBe(1);
    // Nothing was stored: the conversation is as it was.
    expect((await asMember().chat.history({ projectId: fx.projectId })).messages).toEqual([]);
  });

  it("says how to pull a missing model", async () => {
    reply = { status: 404, body: { error: "model 'qwen3:4b' not found" } };
    await expect(asMember().chat.send({ projectId: fx.projectId, message: "Again", durationS: 8 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("ollama pull qwen3:4b"),
    });
  });

  it("says Ollama is not running when nothing answers", async () => {
    const offline = createServerChat(db, { env: { OLLAMA_URL: "http://127.0.0.1:9" } });
    await expect(testCaller({ db, userId: MEMBER, chat: offline }).chat.send({ projectId: fx.projectId, message: "Hi", durationS: 8 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("ollama serve"),
    });
    expect(await offline.test("ollama")).toMatchObject({ ok: false });
  });

  it("applies a proposal and relaunches the new version with the given settings", async () => {
    reply = { status: 200, body: { message: { role: "assistant", content: JSON.stringify(PROPOSAL) } } };
    const adapter = fakeAdapter({ modelKey: "fake" });
    const caller = asMember([adapter]);
    const { assistant } = await caller.chat.send({ projectId: fx.projectId, message: "Relaunch it", durationS: 8 });
    const launched = await caller.chat.applyAndLaunch({ projectId: fx.projectId, messageId: assistant.id, launch: { modelKey: "fake", tier: "final", durationS: 8, resolution: "720p" } as never });

    expect(launched.script.origin).toBe("chat");
    // A relaunch is a draft whatever the client sends.
    expect(launched.generation).toMatchObject({ scriptId: launched.script.id, modelKey: "fake", durationS: 8, status: "in_progress", tier: "draft" });
    expect(adapter.calls.at(-1)!.script?.lines).toEqual(PROPOSAL.lines.map(({ role, text, emotion }) => ({ role, text, emotion })));
  });

  it("refuses to relaunch a proposal too long for the clip, before applying it", async () => {
    const long = { ...PROPOSAL, lines: [{ role: "hook", text: Array.from({ length: 30 }, (_, i) => `word${i}`).join(" "), emotion: "neutral" }] };
    reply = { status: 200, body: { message: { role: "assistant", content: JSON.stringify(long) } } };
    const caller = asMember();
    const { assistant } = await caller.chat.send({ projectId: fx.projectId, message: "Long", durationS: 20 });
    const before = (await caller.script.history({ projectId: fx.projectId })).length;
    await expect(caller.chat.applyAndLaunch({ projectId: fx.projectId, messageId: assistant.id, launch: { modelKey: "fake", durationS: 6, resolution: "720p" } })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("12s") });
    expect(await caller.script.history({ projectId: fx.projectId })).toHaveLength(before);
  });

  it("keeps another workspace's chat out of reach", async () => {
    await asMember().chat.send({ projectId: fx.projectId, message: "Sharper", durationS: 8 });
    const stranger = testCaller({ db, userId: STRANGER, chat: chat() });
    await expect(stranger.chat.history({ projectId: fx.projectId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const [message] = (await asMember().chat.history({ projectId: fx.projectId })).messages.filter((m) => m.proposal);
    const theirs = await seedFixture(db, { userId: "73333333-3333-4333-8333-333333333333", name: "Third" });
    const third = testCaller({ db, userId: "73333333-3333-4333-8333-333333333333", chat: chat() });
    await expect(third.chat.applyProposal({ projectId: theirs.projectId, messageId: message!.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("fails clearly where no chat is wired", async () => {
    await expect(testCaller({ db, userId: MEMBER }).chat.send({ projectId: fx.projectId, message: "Hi", durationS: 8 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await testCaller({ db, userId: MEMBER }).chat.history({ projectId: fx.projectId })).provider).toBeNull();
  });
});

describe("failures", () => {
  // A backend whose model fails in a way no user should read about.
  const broken = () => {
    const real = chat();
    return { ...real, load: async () => ({ ...(await real.load()), model: { propose: async () => { throw new Error("password=hunter2 at 10.0.0.5"); } } }) };
  };

  it("logs an unexpected failure and tells the user only that the model could not answer", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const error = await testCaller({ db, userId: MEMBER, chat: broken() }).chat.send({ projectId: fx.projectId, message: "Hi", durationS: 8 }).catch((e: unknown) => e);
      expect(error).toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Ollama could not answer. Try again; the server's log has the details." });
      expect(JSON.stringify(error)).not.toContain("hunter2");
      expect(logged.mock.calls.flat().join(" ")).toContain("hunter2");
    } finally {
      logged.mockRestore();
    }
  });

  it("treats a stored proposal it cannot read as nothing to apply, for Apply & relaunch too", async () => {
    const [row] = await db.insert(chatMessages).values({ projectId: fx.projectId, role: "assistant", content: "Old", proposal: { bogus: true } as never }).returning();
    await expect(asMember().chat.applyAndLaunch({ projectId: fx.projectId, messageId: row!.id, launch: { modelKey: "fake", durationS: 8, resolution: "720p" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(asMember().chat.applyProposal({ projectId: fx.projectId, messageId: row!.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("chat settings", () => {
  it("shows the environment's defaults, then a saved choice, and refuses a refused address", async () => {
    const caller = asMember();
    const initial = await caller.settings.chat.get();
    expect(initial).toMatchObject({ offers: ["ollama", "anthropic"], saved: {}, active: { provider: "ollama", modelId: "qwen3:4b" }, defaults: { ollamaUrl: ollama.url, wordsPerSecond: 2.5 } });

    const saved = await caller.settings.chat.save({ ollamaModel: "llama3.2:3b", instructions: "Friendly." });
    expect(saved.active).toMatchObject({ provider: "ollama", modelId: "llama3.2:3b" });
    await expect(caller.settings.chat.save({ ollamaUrl: "http://169.254.169.254" })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // The Test button checks that the model is pulled.
    expect(await caller.settings.chat.test({ provider: "ollama" })).toMatchObject({ ok: false, message: expect.stringContaining("ollama pull llama3.2:3b") });
    await caller.settings.chat.save({ ollamaModel: null });
    expect(await caller.settings.chat.test({ provider: "ollama" })).toMatchObject({ ok: true });
  });

  it("chooses Claude when its environment has a key, unless Ollama is chosen, without reading process.env", async () => {
    const withKey = createServerChat(db, { env: { OLLAMA_URL: ollama.url, ANTHROPIC_API_KEY: "sk-ant-test" } });
    try {
      expect((await withKey.load()).provider).toBe("anthropic");
      await asMember().settings.chat.save({ provider: "ollama" });
      expect((await withKey.load()).provider).toBe("ollama");
      await asMember().settings.chat.save({ provider: "anthropic" });
      expect((await withKey.load()).modelId).toBe("claude-opus-5-5");
    } finally {
      await asMember().settings.chat.save({ provider: null });
    }
    expect((await createServerChat(db, { env: { OLLAMA_URL: ollama.url } }).load()).provider).toBe("ollama");
  });
});
