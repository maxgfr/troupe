import { ChatProviderError, parseJsonAnswer, type ChatConnectionReport, type ChatModel } from "~/modules/chat";

// Any chat model of OpenRouter, with the user's OpenRouter key: POST
// /chat/completions with the proposal's JSON schema as a structured output
// (response_format json_schema). Plain fetch and nothing else, so the
// browser edition calls it from the page too.
// https://openrouter.ai/docs/api/reference/overview

export const OPENROUTER_API = "https://openrouter.ai/api/v1";

// Cheap (about $0.002 a proposal), fast, multilingual, and it keeps to a
// JSON schema with structured outputs.
export const DEFAULT_OPENROUTER_CHAT_MODEL = "google/gemini-3.5-flash-lite";

export interface OpenRouterChatOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  // TROUPE_CHAT_TEMPERATURE; unset: the model's own default.
  temperature?: number | null;
  fetch?: typeof fetch;
  // Tests point this elsewhere.
  baseUrl?: string;
}

// The longest answer asked for when the caller sets no cap: a 20-line script
// with room to spare.
const DEFAULT_MAX_TOKENS = 4000;

async function call(options: OpenRouterChatOptions, path: string, init: RequestInit & { signal?: AbortSignal }) {
  const doFetch = options.fetch ?? fetch;
  const signal = init.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(options.timeoutMs)])
    : AbortSignal.timeout(options.timeoutMs);
  try {
    return await doFetch(`${(options.baseUrl ?? OPENROUTER_API).replace(/\/+$/, "")}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
        // OpenRouter's app attribution: who sends the request, never the user.
        "x-title": "Troupe",
        ...(init.headers as Record<string, string> | undefined),
      },
      signal,
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    if ((error as Error).name === "TimeoutError")
      throw new ChatProviderError(
        `OpenRouter took longer than ${Math.round(options.timeoutMs / 1000)} s to answer. Try again, or choose a faster model.`,
      );
    throw new ChatProviderError("OpenRouter could not be reached. Check the internet connection.");
  }
}

// OpenRouter's error message, never the key (it is never echoed back, and
// the text is cut short).
async function errorOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } | string };
    const message = typeof body.error === "string" ? body.error : body.error?.message;
    return typeof message === "string" ? message.slice(0, 300) : "";
  } catch {
    return "";
  }
}

// The status said as what to do next.
function explain(status: number, detail: string, model: string): ChatProviderError {
  if (status === 401 || status === 403)
    return new ChatProviderError("OpenRouter refused the API key. Check it under Provider accounts in Settings.");
  if (status === 402)
    return new ChatProviderError(
      "OpenRouter says the account is out of credits. Add some at openrouter.ai, then try again.",
    );
  if (status === 404)
    return new ChatProviderError(`OpenRouter has no model "${model}". Check the OpenRouter model in Settings.`);
  if (status === 429)
    return new ChatProviderError("OpenRouter is limiting requests from this key. Try again in a minute.");
  if (status === 400)
    return new ChatProviderError(
      `OpenRouter could not take this request${detail ? `: ${detail}` : ""}. A model without structured outputs cannot hold the script's format; choose another one in Settings.`,
    );
  return new ChatProviderError(`OpenRouter could not answer (${status}${detail ? `: ${detail}` : ""}). Try again.`);
}

type Completion = {
  choices?: { message?: { content?: unknown; refusal?: unknown }; finish_reason?: unknown }[];
  error?: { message?: unknown };
};

export function createOpenRouterChat(options: OpenRouterChatOptions): ChatModel {
  return {
    async propose(messages, { schema, signal, maxTokens }) {
      const response = await call(options, "/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model: options.model,
          messages,
          response_format: { type: "json_schema", json_schema: { name: "answer", strict: true, schema } },
          // Only providers that honour the schema are picked.
          provider: { require_parameters: true },
          max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
          ...(options.temperature != null ? { temperature: options.temperature } : {}),
        }),
        signal,
      });
      if (!response.ok) throw explain(response.status, await errorOf(response), options.model);
      const body = (await response.json()) as Completion;
      // An upstream failure can come back with a 200 and an error body.
      if (body.error) {
        const detail = typeof body.error.message === "string" ? body.error.message.slice(0, 300) : "";
        throw new ChatProviderError(`OpenRouter could not answer${detail ? `: ${detail}` : ""}. Try again.`);
      }
      const message = body.choices?.[0]?.message;
      if (typeof message?.refusal === "string" && message.refusal)
        throw new ChatProviderError("The model declined this request. Rephrase it and try again.");
      const text = typeof message?.content === "string" ? message.content : "";
      return { text, proposal: parseJsonAnswer(text) };
    },
  };
}

// Settings' Test: the key works, without spending anything (GET /key).
export async function testOpenRouter(options: OpenRouterChatOptions): Promise<ChatConnectionReport> {
  let response: Response;
  try {
    response = await call({ ...options, timeoutMs: Math.min(options.timeoutMs, 15_000) }, "/key", { method: "GET" });
  } catch (error) {
    return {
      ok: false,
      message: error instanceof ChatProviderError ? error.message : "OpenRouter could not be reached.",
    };
  }
  if (!response.ok) return { ok: false, message: explain(response.status, "", options.model).message };
  const body = (await response.json().catch(() => ({}))) as {
    data?: { limit_remaining?: unknown };
  };
  const left = body.data?.limit_remaining;
  return {
    ok: true,
    message: `OpenRouter accepts the key; the chat answers with ${options.model}${typeof left === "number" ? ` ($${left.toFixed(2)} left on this key)` : ""}.`,
  };
}
