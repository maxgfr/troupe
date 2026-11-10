import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "~/test/db";
import { seedFixture, type Fixture } from "~/test/fixture";
import { testCaller } from "~/test/caller";
import { fakeAdapter } from "~/test/adapters";
import type { Db } from "~/server/db/types";
import type { AssistantMessage, AssistantModel, ToolCall } from "~/server/assistant/loop";
import { setAssistantModelForTests } from "./assistant";

const MEMBER = "86666666-6666-4666-8666-666666666666";

let t: TestDb;
let db: Db;
let fx: Fixture;

beforeAll(async () => {
  t = await createTestDb();
  db = t.db as unknown as Db;
  fx = await seedFixture(db, { userId: MEMBER, name: "Assistant" });
});
afterEach(() => {
  setAssistantModelForTests(null);
  vi.unstubAllEnvs();
});
afterAll(() => setAssistantModelForTests(null));

const model = fakeAdapter({ modelKey: "fal-kling", family: "fal" });
const caller = () => testCaller({ db, userId: MEMBER, adapters: [model] });

const call = (id: string, name: string, args: unknown): ToolCall => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});

function scripted(answers: Awaited<ReturnType<AssistantModel>>[]) {
  const model: AssistantModel = async () => {
    const next = answers.shift();
    if (!next) throw new Error("asked once too often");
    return next;
  };
  setAssistantModelForTests(model);
}

const results = (messages: AssistantMessage[]) =>
  messages.flatMap((m) => (m.role === "tool" ? [JSON.parse(m.content) as Record<string, unknown>] : []));

describe("assistant router", () => {
  it("says it needs an OpenRouter key before anything else", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(await caller().assistant.status({ workspaceId: fx.workspaceId })).toMatchObject({
      ready: false,
      problem: expect.stringMatching(/OpenRouter key/),
    });
    await expect(
      caller().assistant.send({ workspaceId: fx.workspaceId, messages: [{ role: "user", content: "Hi" }] }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("runs the studio's own procedures for a free tool, scoped to the workspace", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or-test");
    expect((await caller().assistant.status({ workspaceId: fx.workspaceId })).ready).toBe(true);
    scripted([
      { content: null, tool_calls: [call("c1", "list_actors", { gender: "female" }), call("c2", "list_projects", {})] },
      { content: "Here they are." },
    ]);
    const turn = await caller().assistant.send({
      workspaceId: fx.workspaceId,
      messages: [{ role: "user", content: "Who can I cast, and what projects do I have?" }],
    });
    expect(turn.pending).toBeNull();
    const [actors, projects] = results(turn.messages);
    expect(actors).toMatchObject({ ok: true });
    expect((actors!.data as { gender: string }[]).length).toBeGreaterThan(0);
    expect((actors!.data as { gender: string }[]).every((a) => a.gender === "female")).toBe(true);
    expect(projects).toMatchObject({ ok: true, data: [expect.objectContaining({ id: fx.projectId })] });
    expect(turn.messages.at(-1)).toEqual({ role: "assistant", content: "Here they are." });
  });

  it("holds a paid tool for the user's decision, and drops it when cancelled", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or-test");
    scripted([
      {
        content: null,
        tool_calls: [
          call("c3", "create_actor", {
            name: "Nina",
            gender: "female",
            ageRange: "25-34",
            style: "casual",
            look: "Short black hair, round glasses, denim jacket.",
            voiceProfile: "warm and upbeat",
          }),
        ],
      },
    ]);
    const waiting = await caller().assistant.send({
      workspaceId: fx.workspaceId,
      messages: [{ role: "user", content: "Make me an influencer called Nina." }],
    });
    expect(waiting.pending).toMatchObject({
      toolCallId: "c3",
      tool: "create_actor",
      summary: expect.stringMatching(/^Make Nina \(female, 25-34, casual\): 6 pictures/),
    });

    scripted([{ content: "OK, I did not make her." }]);
    const done = await caller().assistant.decide({
      workspaceId: fx.workspaceId,
      messages: waiting.messages,
      toolCallId: "c3",
      approve: false,
    });
    expect(results(done.messages)[0]).toMatchObject({ ok: false, summary: expect.stringMatching(/cancelled/) });
    expect((await caller().actors.list()).some((a) => a.name === "Nina")).toBe(false);
  });

  it("creates a project and saves its script through the tools", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or-test");
    const actor = (await caller().actors.list()).find((a) => a.status === "active")!;
    // The model learns the new project's id from the tool's result.
    let projectId = "";
    setAssistantModelForTests(async (messages) => {
      const last = messages.at(-1);
      if (last?.role === "user")
        return {
          content: null,
          tool_calls: [call("p1", "create_project", { title: "Folding cup", actorId: actor.id, platform: "tiktok" })],
        };
      const outcome = JSON.parse((last as { content: string }).content) as { data: { id: string } };
      if (!projectId) {
        projectId = outcome.data.id;
        return {
          content: null,
          tool_calls: [
            call("p2", "set_script", {
              projectId,
              lines: [
                { text: "This cup folds flat.", emotion: "excited" },
                { text: "Link in bio.", emotion: "calm" },
              ],
            }),
          ],
        };
      }
      return { content: "Done." };
    });
    const turn = await caller().assistant.send({
      workspaceId: fx.workspaceId,
      messages: [{ role: "user", content: "Make a TikTok about a folding cup." }],
    });
    const [created, script] = results(turn.messages);
    expect(created).toMatchObject({ ok: true, link: { href: `/projects/${projectId}` } });
    expect(script).toMatchObject({ ok: true, data: { version: 1 } });
    const history = await caller().script.history({ projectId });
    expect(history.at(-1)!.lines.map((l) => [l.text, l.emotion])).toEqual([
      ["This cup folds flat.", "excited"],
      ["Link in bio.", "calm"],
    ]);
  });

  it("refuses a conversation that does not end with the user's message", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or-test");
    await expect(
      caller().assistant.send({
        workspaceId: fx.workspaceId,
        messages: [
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Hello" },
        ],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
