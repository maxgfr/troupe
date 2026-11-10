import { describe, expect, it } from "vitest";

import { ChatProviderError, proposalJsonSchema } from "~/modules/chat";
import { createOpenRouterChat, DEFAULT_OPENROUTER_CHAT_MODEL, testOpenRouter } from "./openrouter";

type Call = { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> | null };

// A fake OpenRouter: answers every request with `status` and `body`, records them.
function fake(status: number, body: unknown) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers as HeadersInit).forEach((v, k) => {
      headers[k] = v;
    });
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
    });
    return new Response(JSON.stringify(body), { status });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const options = (f: typeof fetch) => ({
  apiKey: "or-secret",
  model: DEFAULT_OPENROUTER_CHAT_MODEL,
  timeoutMs: 5_000,
  fetch: f,
});

const PROPOSAL_SCHEMA = proposalJsonSchema(["Fatou"]);
const PROPOSAL = { reply: "Shorter hook.", lines: [{ text: "Stop scrolling.", emotion: "excited" }] };
const messages = [
  { role: "system" as const, content: "You write scripts." },
  { role: "user" as const, content: "Make the hook shorter." },
];

describe("the OpenRouter chat", () => {
  it("asks for an answer held to the schema, with the key in a header, and reads it", async () => {
    const or = fake(200, { choices: [{ message: { content: JSON.stringify(PROPOSAL) } }] });
    const answer = await createOpenRouterChat(options(or.fetch)).propose(messages, {
      schema: PROPOSAL_SCHEMA,
      maxTokens: 1200,
    });
    expect(answer.proposal).toEqual(PROPOSAL);
    const [call] = or.calls;
    expect(call!.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(call!.headers.authorization).toBe("Bearer or-secret");
    expect(call!.body).toMatchObject({
      model: "google/gemini-3.5-flash-lite",
      messages,
      response_format: { type: "json_schema", json_schema: { name: "answer", strict: true, schema: PROPOSAL_SCHEMA } },
      provider: { require_parameters: true },
      max_tokens: 1200,
    });
    expect(call!.body).not.toHaveProperty("temperature");
  });

  it("keeps an answer that is not JSON as text, for the chat to show", async () => {
    const or = fake(200, { choices: [{ message: { content: "Sorry, no." } }] });
    const answer = await createOpenRouterChat(options(or.fetch)).propose(messages, { schema: PROPOSAL_SCHEMA });
    expect(answer).toEqual({ text: "Sorry, no.", proposal: null });
    expect(or.calls[0]!.body).toMatchObject({ max_tokens: 4000 });
  });

  it.each([
    [401, /refused the API key/],
    [402, /out of credits/],
    [404, /no model "google\/gemini-3.5-flash-lite"/],
    [429, /limiting requests/],
    [400, /structured outputs/],
    [503, /could not answer \(503: busy\)/],
  ])("says what to do when OpenRouter answers %i", async (status, message) => {
    const or = fake(status, { error: { message: "busy" } });
    const propose = createOpenRouterChat(options(or.fetch)).propose(messages, { schema: PROPOSAL_SCHEMA });
    await expect(propose).rejects.toBeInstanceOf(ChatProviderError);
    await expect(propose).rejects.toThrow(message);
  });

  it("reports a refusal, and an upstream error sent with a 200", async () => {
    const refused = fake(200, { choices: [{ message: { content: null, refusal: "No." } }] });
    await expect(
      createOpenRouterChat(options(refused.fetch)).propose(messages, { schema: PROPOSAL_SCHEMA }),
    ).rejects.toThrow(/declined/);
    const failed = fake(200, { error: { message: "Provider returned error" } });
    await expect(
      createOpenRouterChat(options(failed.fetch)).propose(messages, { schema: PROPOSAL_SCHEMA }),
    ).rejects.toThrow(/Provider returned error/);
  });

  it("never puts the key in an error", async () => {
    const or = fake(401, { error: { message: "bad key" } });
    const error = await createOpenRouterChat(options(or.fetch))
      .propose(messages, { schema: PROPOSAL_SCHEMA })
      .catch((e: Error) => e);
    expect(String((error as Error).message)).not.toContain("or-secret");
  });
});

describe("the OpenRouter chat test", () => {
  it("checks the key for free and says what is left on it", async () => {
    const or = fake(200, { data: { limit_remaining: 12.5 } });
    const report = await testOpenRouter(options(or.fetch));
    expect(report).toEqual({
      ok: true,
      message:
        "OpenRouter accepts the key; the chat answers with google/gemini-3.5-flash-lite ($12.50 left on this key).",
    });
    expect(or.calls[0]).toMatchObject({ url: "https://openrouter.ai/api/v1/key", method: "GET" });
  });

  it("reports a refused key", async () => {
    const or = fake(401, {});
    expect(await testOpenRouter(options(or.fetch))).toEqual({
      ok: false,
      message: "OpenRouter refused the API key. Check it under Provider accounts in Settings.",
    });
  });
});
