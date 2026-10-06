import type { Embedder, Vision } from "~/modules/library";
import { checkLocalUrl } from "~/server/settings/urls";

// The library's embedding and vision models, on the same Ollama as the
// script chat (or TROUPE_LIBRARY_OLLAMA_URL). Requests never follow a
// redirect, so an answer can only come from the address checked here.
// https://github.com/ollama/ollama/blob/main/docs/api.md

export interface OllamaTarget {
  baseUrl: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

async function call(
  target: OllamaTarget,
  path: string,
  init: RequestInit & { signal?: AbortSignal; timeoutMs?: number },
): Promise<Response> {
  const url = checkLocalUrl(target.baseUrl);
  if (!url.ok) throw new Error(`The Ollama address is not allowed: ${url.reason}`);
  const timeout = AbortSignal.timeout(init.timeoutMs ?? target.timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  try {
    return await (target.fetch ?? fetch)(`${url.base}${path}`, { ...init, signal, redirect: "error" });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    if ((error as Error).name === "TimeoutError")
      throw new Error(
        `Ollama took longer than ${Math.round((init.timeoutMs ?? target.timeoutMs) / 1000)} s (TROUPE_LIBRARY_OLLAMA_TIMEOUT_S).`,
      );
    throw new Error(`Ollama is not answering at ${target.baseUrl}.`);
  }
}

async function failure(response: Response, model: string): Promise<Error> {
  const body = (await response.json().catch(() => ({}))) as { error?: unknown };
  const said = typeof body.error === "string" ? body.error : "";
  if (response.status === 404)
    return new Error(`Ollama does not have ${model} yet. Pull it with \`ollama pull ${model}\`.`);
  return new Error(`Ollama could not answer (${response.status}${said ? `: ${said.slice(0, 200)}` : ""}).`);
}

// The models Ollama has, by every name it answers to ("qwen3" is "qwen3:latest").
export async function pulledModels(target: OllamaTarget): Promise<Set<string>> {
  const response = await call(target, "/api/tags", { method: "GET", timeoutMs: Math.min(target.timeoutMs, 10_000) });
  if (!response.ok)
    throw new Error(`Something answered at ${target.baseUrl}, but not as Ollama does (${response.status}).`);
  const body = (await response.json().catch(() => ({}))) as { models?: { name?: string; model?: string }[] };
  return new Set((body.models ?? []).flatMap((m) => [m.name, m.model]).filter((n): n is string => Boolean(n)));
}

export const hasModel = (pulled: Set<string>, model: string) =>
  pulled.has(model) || pulled.has(model.includes(":") ? model : `${model}:latest`);

// What some embedding models expect before a query or a passage.
export function embeddingPrefixes(model: string): { query: string; passage: string } {
  const name = model.toLowerCase();
  if (name.startsWith("qwen3-embedding"))
    return {
      query:
        "Instruct: Given a question, retrieve passages from a creator's saved videos, posts and articles that answer it\nQuery: ",
      passage: "",
    };
  if (name.startsWith("nomic-embed")) return { query: "search_query: ", passage: "search_document: " };
  if (name.includes("e5")) return { query: "query: ", passage: "passage: " };
  return { query: "", passage: "" };
}

export function ollamaEmbedder(target: OllamaTarget, model: string): Embedder {
  const prefixes = embeddingPrefixes(model);
  return {
    model,
    async embed(texts, kind, options) {
      const prefix = kind === "query" ? prefixes.query : prefixes.passage;
      const response = await call(target, "/api/embed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, input: texts.map((t) => `${prefix}${t}`), truncate: true }),
        signal: options?.signal,
      });
      if (!response.ok) throw await failure(response, model);
      const body = (await response.json()) as { embeddings?: unknown };
      const vectors = Array.isArray(body.embeddings) ? (body.embeddings as unknown[]) : [];
      if (
        vectors.length !== texts.length ||
        !vectors.every((v) => Array.isArray(v) && v.every((x) => typeof x === "number"))
      )
        throw new Error(`${model} did not return one vector per passage.`);
      return vectors as number[][];
    },
  };
}

const VISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["description", "text"],
  properties: {
    description: { type: "string", description: "One or two sentences: who or what is in it, the setting, the shot." },
    text: {
      type: "string",
      description: "Every word written in the picture (captions, titles, signs), exactly; empty if none.",
    },
  },
} as const;

const VISION_PROMPT =
  "Say what this picture shows in one or two plain sentences: the people, objects and setting, and how it is framed (close-up, wide, screen recording…). Do not say that it is a picture or a frame. Then copy any words written in it exactly, or leave the text empty. Answer with the JSON object only.";

export function ollamaVision(target: OllamaTarget, model: string): Vision {
  return {
    model,
    async read(picture, options) {
      const response = await call(target, "/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          think: false,
          format: VISION_SCHEMA,
          options: { temperature: 0 },
          messages: [{ role: "user", content: VISION_PROMPT, images: [Buffer.from(picture.bytes).toString("base64")] }],
        }),
        signal: options.signal,
      });
      if (!response.ok) throw await failure(response, model);
      const body = (await response.json()) as { message?: { content?: unknown } };
      const content = typeof body.message?.content === "string" ? body.message.content : "";
      let parsed: { description?: unknown; text?: unknown } = {};
      try {
        parsed = JSON.parse(content);
      } catch {
        return { description: content.trim().slice(0, 500), text: "" };
      }
      const clean = (v: unknown, max: number) =>
        typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
      const text = clean(parsed.text, 500);
      // Small models copy a piece of the instructions when nothing is written.
      const echoed =
        text.length > 0 && (VISION_PROMPT + JSON.stringify(VISION_SCHEMA)).toLowerCase().includes(text.toLowerCase());
      return { description: clean(parsed.description, 500), text: echoed ? "" : text };
    },
  };
}
