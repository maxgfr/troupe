import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  openRouterAssistantModel,
  runAssistant,
  type AssistantMessage,
  type AssistantModel,
  type AssistantTool,
  type ToolCall,
} from "./loop";

type Ctx = { log: string[] };

const free: AssistantTool<{ gender?: string }, Ctx> = {
  name: "list_actors",
  description: "List actors.",
  parameters: { type: "object", properties: {} },
  args: z.object({ gender: z.string().optional() }),
  async run(args, ctx) {
    ctx.log.push(`list ${args.gender ?? "all"}`);
    return { ok: true, summary: "2 actors.", data: [{ id: "a1", name: "Fatou" }] };
  },
};

const paid: AssistantTool<{ name: string }, Ctx> = {
  name: "create_actor",
  description: "Make an actor.",
  parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  args: z.object({ name: z.string().min(1) }),
  async quote(args) {
    return { summary: `Make ${args.name}, about $0.054.`, estimatedCostUsd: 0.054 };
  },
  async run(args, ctx) {
    ctx.log.push(`create ${args.name}`);
    return { ok: true, summary: `Made ${args.name}.`, link: { label: "Actors", href: "/actors" } };
  },
};

const tools = [free, paid] as unknown as AssistantTool<never, Ctx>[];

const call = (id: string, name: string, args: unknown): ToolCall => ({
  id,
  type: "function",
  function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
});

// A scripted model: each answer in turn, with what it was sent recorded.
function scripted(answers: Awaited<ReturnType<AssistantModel>>[]) {
  const seen: Parameters<AssistantModel>[0][] = [];
  const model: AssistantModel = async (messages) => {
    seen.push(messages);
    const next = answers.shift();
    if (!next) throw new Error("the model was asked once too often");
    return next;
  };
  return { model, seen };
}

const user = (content: string): AssistantMessage => ({ role: "user", content });
const toolResults = (messages: AssistantMessage[]) =>
  messages.flatMap((m) => (m.role === "tool" ? [JSON.parse(m.content) as { ok: boolean; summary: string }] : []));

describe("the assistant's loop", () => {
  it("runs a free tool at once, gives the model its result, and ends on its words", async () => {
    const ctx: Ctx = { log: [] };
    const { model, seen } = scripted([
      { content: null, tool_calls: [call("c1", "list_actors", { gender: "female" })] },
      { content: "Fatou is free." },
    ]);
    const result = await runAssistant({ system: "S", messages: [user("Who can I cast?")], tools, ctx, model });
    expect(ctx.log).toEqual(["list female"]);
    expect(result.pending).toBeNull();
    expect(result.messages.at(-1)).toEqual({ role: "assistant", content: "Fatou is free." });
    expect(seen[0]![0]).toEqual({ role: "system", content: "S" });
    expect(seen[1]!.at(-1)).toMatchObject({ role: "tool", tool_call_id: "c1" });
    expect(toolResults(result.messages)[0]).toMatchObject({ ok: true, summary: "2 actors." });
  });

  it("stops at a paid tool with its quote, runs it once confirmed, then goes on", async () => {
    const ctx: Ctx = { log: [] };
    const first = scripted([{ content: "Making her.", tool_calls: [call("c2", "create_actor", { name: "Nina" })] }]);
    const waiting = await runAssistant({ system: "S", messages: [user("Make Nina")], tools, ctx, model: first.model });
    expect(waiting.pending).toEqual({
      toolCallId: "c2",
      tool: "create_actor",
      summary: "Make Nina, about $0.054.",
      estimatedCostUsd: 0.054,
    });
    expect(ctx.log).toEqual([]);

    const then = scripted([{ content: "Nina is ready." }]);
    const done = await runAssistant({
      system: "S",
      messages: waiting.messages,
      tools,
      ctx,
      model: then.model,
      decision: { toolCallId: "c2", approve: true },
    });
    expect(ctx.log).toEqual(["create Nina"]);
    expect(done.pending).toBeNull();
    expect(toolResults(done.messages)).toEqual([
      { ok: true, summary: "Made Nina.", link: { label: "Actors", href: "/actors" } },
    ]);
    expect(done.messages.at(-1)).toEqual({ role: "assistant", content: "Nina is ready." });
  });

  it("drops a cancelled paid tool and tells the model", async () => {
    const ctx: Ctx = { log: [] };
    const first = scripted([{ content: null, tool_calls: [call("c3", "create_actor", { name: "Nina" })] }]);
    const waiting = await runAssistant({ system: "S", messages: [user("Make Nina")], tools, ctx, model: first.model });
    const then = scripted([{ content: "Cancelled." }]);
    const done = await runAssistant({
      system: "S",
      messages: waiting.messages,
      tools,
      ctx,
      model: then.model,
      decision: { toolCallId: "c3", approve: false },
    });
    expect(ctx.log).toEqual([]);
    expect(toolResults(done.messages)[0]).toMatchObject({ ok: false, summary: expect.stringMatching(/cancelled/) });
  });

  it("answers a confirmation for another call with the quote again, never a run", async () => {
    const ctx: Ctx = { log: [] };
    const first = scripted([{ content: null, tool_calls: [call("c4", "create_actor", { name: "Nina" })] }]);
    const waiting = await runAssistant({ system: "S", messages: [user("Make Nina")], tools, ctx, model: first.model });
    const again = await runAssistant({
      system: "S",
      messages: waiting.messages,
      tools,
      ctx,
      model: scripted([]).model,
      decision: { toolCallId: "other", approve: true },
    });
    expect(again.pending?.toolCallId).toBe("c4");
    expect(ctx.log).toEqual([]);
  });

  it("reports an unknown tool, arguments that are not JSON, and invalid ones back to the model", async () => {
    const ctx: Ctx = { log: [] };
    const { model } = scripted([
      {
        content: null,
        tool_calls: [
          call("u1", "delete_everything", {}),
          call("u2", "list_actors", "{oops"),
          call("u3", "create_actor", { name: "" }),
        ],
      },
      { content: "Sorry." },
    ]);
    const result = await runAssistant({ system: "S", messages: [user("Go")], tools, ctx, model });
    const [unknown, notJson, invalid] = toolResults(result.messages);
    expect(unknown).toMatchObject({
      ok: false,
      summary: expect.stringMatching(/no tool "delete_everything".*list_actors, create_actor/),
    });
    expect(notJson).toMatchObject({ ok: false, summary: expect.stringMatching(/not valid JSON/) });
    expect(invalid).toMatchObject({ ok: false, summary: expect.stringMatching(/^Invalid arguments: name/) });
    expect(ctx.log).toEqual([]);
    expect(result.pending).toBeNull();
  });

  it("reports a tool's failure to the model instead of failing the turn", async () => {
    const broken: AssistantTool<Record<string, never>, Ctx> = {
      ...(free as unknown as AssistantTool<Record<string, never>, Ctx>),
      async run() {
        throw new Error(JSON.stringify([{ path: ["title"], message: "Required" }]));
      },
    };
    const { model } = scripted([
      { content: null, tool_calls: [call("b1", "list_actors", {})] },
      { content: "It failed." },
    ]);
    const result = await runAssistant({
      system: "S",
      messages: [user("Go")],
      tools: [broken] as unknown as AssistantTool<never, Ctx>[],
      ctx: { log: [] },
      model,
    });
    expect(toolResults(result.messages)[0]).toEqual({ ok: false, summary: "title: Required" });
  });

  it("stops after its step limit", async () => {
    const forever: AssistantModel = async () => ({
      content: null,
      tool_calls: [call(`x${Math.random()}`, "list_actors", {})],
    });
    const result = await runAssistant({
      system: "S",
      messages: [user("Loop")],
      tools,
      ctx: { log: [] },
      model: forever,
      maxSteps: 2,
    });
    expect(result.messages.at(-1)).toMatchObject({ role: "assistant", content: expect.stringMatching(/many steps/) });
  });
});

describe("the OpenRouter model of the assistant", () => {
  it("sends the tools as functions and reads the calls back", async () => {
    const calls: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        auth: new Headers(init?.headers as HeadersInit).get("authorization"),
      });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "", tool_calls: [call("t1", "list_actors", {})] } }],
        }),
      );
    }) as typeof globalThis.fetch;
    const model = openRouterAssistantModel({ apiKey: "or-secret", model: "google/gemini-3.5-flash-lite", fetch });
    const reply = await model([{ role: "system", content: "S" }, user("Hi")], tools as AssistantTool<never, never>[]);
    expect(reply).toEqual({ content: null, tool_calls: [call("t1", "list_actors", {})] });
    expect(calls[0]).toMatchObject({
      url: "https://openrouter.ai/api/v1/chat/completions",
      auth: "Bearer or-secret",
      body: {
        model: "google/gemini-3.5-flash-lite",
        tool_choice: "auto",
        tools: [
          { type: "function", function: { name: "list_actors", description: "List actors." } },
          { type: "function", function: { name: "create_actor" } },
        ],
      },
    });
  });

  it("says what to do when the key is refused", async () => {
    const fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "no" } }), { status: 401 })) as typeof globalThis.fetch;
    const model = openRouterAssistantModel({ apiKey: "k", model: "m", fetch });
    await expect(model([user("Hi")], [])).rejects.toThrow(/refused the API key/);
  });
});
