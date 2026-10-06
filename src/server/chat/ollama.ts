import { ChatProviderError, parseJsonAnswer, type ChatConnectionReport, type ChatModel } from "~/modules/chat";
import { checkLocalUrl } from "~/server/settings/urls";

// Ollama on this machine or the LAN: POST /api/chat with the proposal's JSON
// schema as `format`, which Ollama turns into a grammar the model must follow.
// https://github.com/ollama/ollama/blob/main/docs/api.md

export interface OllamaOptions {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  // TROUPE_CHAT_TEMPERATURE; 0.4 keeps small models on the schema while
  // leaving some variety between requests.
  temperature?: number | null;
  fetch?: typeof fetch;
}

export const DEFAULT_OLLAMA_TEMPERATURE = 0.4;

// How to start it: the Docker stack's own service (docker-compose.yml) is
// reached by its service name; any other address is an Ollama installed there.
function startAdvice(baseUrl: string): string {
  let host = "";
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    // An address that does not parse is refused by checkLocalUrl first.
  }
  return host === "ollama" ? "Start the stack's Ollama with `docker compose up -d ollama`" : "Start it with `ollama serve` (or open the Ollama app)";
}

function base(options: OllamaOptions): string {
  const url = checkLocalUrl(options.baseUrl);
  if (!url.ok) throw new ChatProviderError(`The Ollama address is not allowed: ${url.reason}`);
  return url.base;
}

async function call(options: OllamaOptions, path: string, init: RequestInit & { signal?: AbortSignal }): Promise<Response> {
  const doFetch = options.fetch ?? fetch;
  const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(options.timeoutMs)]) : AbortSignal.timeout(options.timeoutMs);
  try {
    // Never followed: a redirect could lead past checkLocalUrl, to a cloud
    // metadata address for one, and its answer would come back to the page.
    return await doFetch(`${base(options)}${path}`, { ...init, signal, redirect: "error" });
  } catch (error) {
    if (error instanceof ChatProviderError) throw error;
    if (init.signal?.aborted) throw error;
    if (/redirect/i.test(String((error as Error & { cause?: unknown }).cause ?? ""))) {
      throw new ChatProviderError(`The server at ${options.baseUrl} answered with a redirect, which Troupe does not follow. Use the address Ollama itself listens on.`);
    }
    if ((error as Error).name === "TimeoutError") throw new ChatProviderError(`Ollama took longer than ${Math.round(options.timeoutMs / 1000)} s to answer. Try a smaller model or raise TROUPE_CHAT_TIMEOUT_S.`);
    throw new ChatProviderError(`Ollama is not answering at ${options.baseUrl}. ${startAdvice(options.baseUrl)}.`);
  }
}

async function errorOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : "";
  } catch {
    return "";
  }
}

// What fits in Ollama's default context with room to spare.
const CONTEXT_MARGIN = 3500;
const promptTokens = (messages: { content: string }[]) => Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 3);

export function createOllamaChat(options: OllamaOptions): ChatModel {
  return {
    async propose(messages, { schema, signal, maxTokens }) {
      const send = (think: boolean) =>
        call(options, "/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: options.model,
            messages,
            stream: false,
            format: schema,
            // Thinking models (qwen3) answer far sooner without the reasoning
            // pass; the schema already shapes the answer.
            ...(think ? {} : { think: false }),
            // The answer's cap, and a longer context than Ollama's default
            // (4,096 tokens) only when the prompt (about 3 characters a token)
            // and the answer could pass it, as the library's ten ideas can:
            // a longer context holds more memory (KV cache, about 1 GB more
            // for a 4B model at 8,192), and a change of context reloads the
            // model.
            options: {
              temperature: options.temperature ?? DEFAULT_OLLAMA_TEMPERATURE,
              ...(maxTokens ? { num_predict: maxTokens } : {}),
              ...(maxTokens && promptTokens(messages) + maxTokens > CONTEXT_MARGIN ? { num_ctx: 8192 } : {}),
            },
          }),
          signal,
        });
      let response = await send(false);
      if (response.status === 400 && /think/i.test(await errorOf(response.clone()))) response = await send(true);
      if (response.status === 404) {
        throw new ChatProviderError(`Ollama does not have the model "${options.model}". Pull it with \`ollama pull ${options.model}\`, or choose another one in Settings.`);
      }
      if (!response.ok) {
        const detail = await errorOf(response);
        throw new ChatProviderError(`Ollama could not answer (${response.status}${detail ? `: ${detail}` : ""}).`);
      }
      const body = (await response.json()) as { message?: { content?: unknown } };
      const text = typeof body.message?.content === "string" ? body.message.content : "";
      return { text, proposal: parseJsonAnswer(text) };
    },
  };
}

// Settings' Test: the server answers and has the model.
export async function testOllama(options: OllamaOptions): Promise<ChatConnectionReport> {
  let response: Response;
  try {
    response = await call({ ...options, timeoutMs: Math.min(options.timeoutMs, 10_000) }, "/api/tags", { method: "GET" });
  } catch (error) {
    return { ok: false, message: error instanceof ChatProviderError ? error.message : "Ollama could not be reached." };
  }
  if (!response.ok) return { ok: false, message: `Something answered at ${options.baseUrl}, but not as Ollama does (${response.status}).` };
  const body = (await response.json().catch(() => ({}))) as { models?: { name?: string; model?: string }[] };
  const names = (body.models ?? []).flatMap((m) => [m.name, m.model]).filter((n): n is string => Boolean(n));
  // "qwen3" means "qwen3:latest" to Ollama.
  const wanted = options.model.includes(":") ? options.model : `${options.model}:latest`;
  if (!names.includes(wanted) && !names.includes(options.model)) {
    return { ok: false, message: `Ollama answers, but "${options.model}" is not pulled. Run \`ollama pull ${options.model}\`.` };
  }
  return { ok: true, message: `Ollama answers and has ${options.model}.` };
}
