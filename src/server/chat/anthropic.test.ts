import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { proposalJsonSchema, type ChatTurn } from "~/modules/chat";
import { json, startServer } from "~/test/local-server";
import { createAnthropicChat, testAnthropic } from "./anthropic";

// A stand-in for api.anthropic.com: the real SDK, over real HTTP, never a
// real key or a paid call.
let server: Awaited<ReturnType<typeof startServer>>;
let reply: { status: number; body: unknown } = { status: 200, body: {} };

beforeAll(async () => {
  server = await startServer((req, res) => {
    if (req.method === "GET" && req.path.startsWith("/v1/models/")) {
      const id = decodeURIComponent(req.path.slice("/v1/models/".length));
      if (id === "claude-nope") return json(res, 404, { type: "error", error: { type: "not_found_error", message: "model not found" } });
      return json(res, 200, { type: "model", id, display_name: "Claude Opus 5.5", created_at: "2026-01-01T00:00:00Z" });
    }
    json(res, reply.status, reply.body);
  });
});

afterAll(() => server.close());

const message = (text: string, stop_reason = "end_turn") => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: [{ type: "text", text }],
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 10 },
});

const turns: ChatTurn[] = [
  { role: "system", content: "You write scripts." },
  { role: "user", content: "Make it short" },
  { role: "assistant", content: "Done before." },
  { role: "user", content: "Shorter still" },
];
const schema = proposalJsonSchema(["Léa"]);
const answer = { summary: "Shorter.", lines: [{ role: "hook", text: "Hi.", emotion: "happy" }], actor: null };

describe("Claude provider", () => {
  it("asks for the proposal's JSON schema as structured output, with the system prompt apart", async () => {
    reply = { status: 200, body: message(JSON.stringify(answer)) };
    const chat = createAnthropicChat({ apiKey: "sk-ant-test", model: "claude-opus-5-5", timeoutMs: 5000, baseURL: server.url });
    const result = await chat.propose(turns, { schema });
    expect(result.proposal).toEqual(answer);

    const request = server.requests.at(-1)!;
    expect(request.path).toMatch(/^\/v1\/messages/);
    expect(request.headers["x-api-key"]).toBe("sk-ant-test");
    expect(request.headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
    const body = JSON.parse(request.body) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "claude-opus-5-5",
      system: "You write scripts.",
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: { required: ["summary", "lines", "actor"] } } },
    });
    expect(body.messages).toEqual(turns.slice(1));
    expect(body).not.toHaveProperty("tool_choice");
  });

  it("explains a refused key, a refusal and an unknown model", async () => {
    const chat = createAnthropicChat({ apiKey: "sk-ant-bad", model: "claude-opus-5-5", timeoutMs: 5000, baseURL: server.url });
    reply = { status: 401, body: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } };
    await expect(chat.propose(turns, { schema })).rejects.toThrow(/refused the API key/);
    reply = { status: 200, body: message("", "refusal") };
    await expect(chat.propose(turns, { schema })).rejects.toThrow(/declined this request/);
    expect(await testAnthropic({ apiKey: "sk-ant-test", model: "claude-nope", timeoutMs: 5000, baseURL: server.url })).toEqual({ ok: false, message: 'Anthropic has no model "claude-nope". Check the Claude model in Settings.' });
  });

  it("tests a key against the model without a paid call", async () => {
    const before = server.requests.length;
    expect(await testAnthropic({ apiKey: "sk-ant-test", model: "claude-opus-5-5", timeoutMs: 5000, baseURL: server.url })).toEqual({ ok: true, message: "The key works and Claude Opus 5.5 is available." });
    expect(server.requests.slice(before).map((r) => `${r.method} ${r.path}`)).toEqual(["GET /v1/models/claude-opus-5-5"]);
  });
});

// What each model is sent: the capability table in claude-models.ts, checked
// on the request bodies the fake API receives.
describe("Claude request per model", () => {
  async function bodyFor(model: string, temperature?: number, serverFallback?: boolean) {
    reply = { status: 200, body: message(JSON.stringify(answer)) };
    await createAnthropicChat({ apiKey: "sk-ant-test", model, timeoutMs: 5000, baseURL: server.url, temperature, serverFallback }).propose(turns, { schema });
    const request = server.requests.at(-1)!;
    return { body: JSON.parse(request.body) as Record<string, unknown>, beta: request.headers["anthropic-beta"] };
  }
  const format = { type: "json_schema", schema: expect.objectContaining({ required: ["summary", "lines", "actor"] }) };

  it("claude-opus-5-5: structured output, low effort and the server-side fallback, never a temperature", async () => {
    const { body, beta } = await bodyFor("claude-opus-5-5", 0.7);
    expect(body).toMatchObject({ output_config: { format, effort: "low" }, fallbacks: "default" });
    expect(body).not.toHaveProperty("temperature");
    expect(beta).toContain("server-side-fallback-2026-07-01");
  });

  it("claude-fable-5 and claude-mythos-5-1: the server-side fallback too, as on Claude Fable 5.1", async () => {
    for (const model of ["claude-fable-5-1", "claude-fable-5", "claude-mythos-5-1"]) {
      const { body, beta } = await bodyFor(model);
      expect(body, model).toMatchObject({ fallbacks: "default" });
      expect(beta, model).toContain("server-side-fallback-2026-07-01");
    }
    // Claude Mythos 5 runs no safety classifiers: nothing to fall back from.
    expect((await bodyFor("claude-mythos-5")).body).not.toHaveProperty("fallbacks");
  });

  it("no fallback beta when the server-side fallback is turned off (a gateway in between)", async () => {
    const { body, beta } = await bodyFor("claude-opus-5-5", undefined, false);
    expect(body).not.toHaveProperty("fallbacks");
    expect(beta ?? "").not.toContain("server-side-fallback");
    expect(body.output_config).toMatchObject({ effort: "low" });
  });

  it("claude-opus-4-8: structured output and low effort, no fallback beta, and no temperature even when one is set", async () => {
    const { body, beta } = await bodyFor("claude-opus-4-8", 0.7);
    expect(body.output_config).toEqual({ format, effort: "low" });
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("fallbacks");
    expect(beta ?? "").not.toContain("server-side-fallback");
  });

  it("claude-haiku-4-5: structured output and the temperature, held to Claude's 0–1, without effort", async () => {
    const { body } = await bodyFor("claude-haiku-4-5", 1.5);
    expect(body.output_config).toEqual({ format });
    expect(body.temperature).toBe(1);
    expect(body).not.toHaveProperty("fallbacks");
    expect((await bodyFor("claude-haiku-4-5")).body).not.toHaveProperty("temperature");
  });

  it("claude-opus-4-6: low effort and a temperature, and the schema in the prompt since it has no structured output", async () => {
    const { body } = await bodyFor("claude-opus-4-6", 0.3);
    expect(body.output_config).toEqual({ effort: "low" });
    expect(body.temperature).toBe(0.3);
    expect(body.system).toContain("You write scripts.");
    expect(body.system).toContain('"required":["summary","lines","actor"]');
  });

  it("an unknown id: nothing that could be refused, the schema in the prompt", async () => {
    const { body, beta } = await bodyFor("claude-future-9", 0.5);
    expect(body).not.toHaveProperty("output_config");
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("fallbacks");
    expect(beta ?? "").not.toContain("server-side-fallback");
    expect(body.system).toContain('"required":["summary","lines","actor"]');
    expect(body.model).toBe("claude-future-9");
  });
});
