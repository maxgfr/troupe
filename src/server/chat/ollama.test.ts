import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ChatProviderError, proposalJsonSchema } from "~/modules/chat";
import { json, startServer } from "~/test/local-server";
import { createOllamaChat, testOllama } from "./ollama";

// A model server on the LAN is trusted only as far as checkLocalUrl allows:
// a redirect could send the request (and bring back the answer) anywhere,
// such as a cloud metadata address, so redirects are never followed.
let server: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  server = await startServer((req, res) => {
    if (req.path === "/direct/api/chat") return json(res, 200, { message: { role: "assistant", content: '{"summary": "ok"}' } });
    if (req.path === "/elsewhere/api/chat" || req.path === "/elsewhere/api/tags") {
      return json(res, 200, { message: { role: "assistant", content: '{"leaked": true}' }, models: [{ name: "qwen3:4b" }] });
    }
    res.writeHead(302, { location: `${server.url}/elsewhere${req.path}` });
    res.end();
  });
});

afterAll(() => server.close());

const schema = proposalJsonSchema([]);

describe("Ollama provider", () => {
  it("refuses to follow a redirect, for a chat or a connection test", async () => {
    const chat = createOllamaChat({ baseUrl: server.url, model: "qwen3:4b", timeoutMs: 5000 });
    await expect(chat.propose([{ role: "user", content: "Hi" }], { schema })).rejects.toThrow(ChatProviderError);
    await expect(chat.propose([{ role: "user", content: "Hi" }], { schema })).rejects.toThrow(/redirect/);
    expect(await testOllama({ baseUrl: server.url, model: "qwen3:4b", timeoutMs: 5000 })).toMatchObject({ ok: false, message: expect.stringMatching(/redirect/) });
    expect(server.requests.some((r) => r.path.startsWith("/elsewhere"))).toBe(false);
  });
});

describe("Ollama generation settings", () => {
  it("asks for a longer context only when the prompt and the answer need one", async () => {
    const chat = createOllamaChat({ baseUrl: `${server.url}/direct`, model: "qwen3:4b", timeoutMs: 5000 });
    await chat.propose([{ role: "user", content: "Hi" }], { schema, maxTokens: 331 });
    expect(JSON.parse(server.requests.at(-1)!.body).options).toEqual({ temperature: 0.4, num_predict: 331 });
    // About 3 characters a token: 12,000 characters and 2,700 tokens of answer pass Ollama's 4,096.
    await chat.propose([{ role: "user", content: "x".repeat(12_000) }], { schema, maxTokens: 2700 });
    expect(JSON.parse(server.requests.at(-1)!.body).options).toEqual({ temperature: 0.4, num_predict: 2700, num_ctx: 8192 });
  });

  it("sends the configured temperature, 0.4 when none is set", async () => {
    await createOllamaChat({ baseUrl: `${server.url}/direct`, model: "qwen3:4b", timeoutMs: 5000, temperature: 0.9 }).propose([{ role: "user", content: "Hi" }], { schema });
    expect(JSON.parse(server.requests.at(-1)!.body).options).toEqual({ temperature: 0.9 });
    await createOllamaChat({ baseUrl: `${server.url}/direct`, model: "qwen3:4b", timeoutMs: 5000 }).propose([{ role: "user", content: "Hi" }], { schema });
    expect(JSON.parse(server.requests.at(-1)!.body).options).toEqual({ temperature: 0.4 });
  });
});

describe("Ollama not answering", () => {
  const down: typeof fetch = async () => {
    throw new TypeError("fetch failed");
  };

  it("says how to start the Docker stack's own Ollama, or the one on this machine", async () => {
    const stack = createOllamaChat({ baseUrl: "http://ollama:11434", model: "qwen3:4b", timeoutMs: 5000, fetch: down });
    await expect(stack.propose([{ role: "user", content: "Hi" }], { schema })).rejects.toThrow(
      "Ollama is not answering at http://ollama:11434. Start the stack's Ollama with `docker compose up -d ollama`.",
    );
    const local = createOllamaChat({ baseUrl: "http://127.0.0.1:11434", model: "qwen3:4b", timeoutMs: 5000, fetch: down });
    await expect(local.propose([{ role: "user", content: "Hi" }], { schema })).rejects.toThrow(
      "Ollama is not answering at http://127.0.0.1:11434. Start it with `ollama serve` (or open the Ollama app).",
    );
  });
});
