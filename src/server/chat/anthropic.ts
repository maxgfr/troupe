import Anthropic from "@anthropic-ai/sdk";

import { ChatProviderError, parseJsonAnswer, type ChatConnectionReport, type ChatModel } from "~/modules/chat";

// Claude through the Anthropic API, with the key saved in Settings or
// ANTHROPIC_API_KEY. The answer is held to the proposal's JSON schema with
// structured outputs (output_config.format): forcing a tool call, the older
// way to get JSON, is refused by the current models.

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

// Models that take an effort level and Anthropic's server-side fallback on a
// declined request. Other ids (an older Haiku, say) are sent without either.
const CURRENT_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1"]);

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  // Tests point this at a local server; ANTHROPIC_BASE_URL works too.
  baseURL?: string;
}

function client(options: AnthropicOptions) {
  return new Anthropic({ apiKey: options.apiKey, baseURL: options.baseURL, timeout: options.timeoutMs, maxRetries: 1 });
}

// The SDK's typed errors, said as what to do next.
function explain(error: unknown, model: string): never {
  if (error instanceof Anthropic.APIUserAbortError) throw error;
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    throw new ChatProviderError("Anthropic refused the API key. Check it under Provider accounts in Settings.");
  }
  if (error instanceof Anthropic.NotFoundError) throw new ChatProviderError(`Anthropic has no model "${model}". Check the Claude model in Settings.`);
  if (error instanceof Anthropic.RateLimitError) throw new ChatProviderError("Anthropic is limiting requests from this key. Try again in a minute.");
  if (error instanceof Anthropic.BadRequestError) throw new ChatProviderError(`Anthropic could not take this request: ${error.message}`);
  if (error instanceof Anthropic.APIConnectionTimeoutError) throw new ChatProviderError("Claude took too long to answer. Try again.");
  if (error instanceof Anthropic.APIConnectionError) throw new ChatProviderError("Anthropic could not be reached. Check this server's internet connection.");
  if (error instanceof Anthropic.APIError) throw new ChatProviderError(`Anthropic could not answer (${error.status ?? "no status"}). Try again.`);
  throw error;
}

export function createAnthropicChat(options: AnthropicOptions): ChatModel {
  const anthropic = client(options);
  return {
    async propose(messages, { schema, signal }) {
      const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const turns: Anthropic.MessageParam[] = messages.flatMap((m) => (m.role === "system" ? [] : [{ role: m.role, content: m.content }]));
      const current = CURRENT_MODELS.has(options.model);
      const params = {
        model: options.model,
        // Room for adaptive thinking and a 20-line script.
        max_tokens: 8000,
        system,
        messages: turns,
        output_config: { format: { type: "json_schema" as const, schema: schema as unknown as Record<string, unknown> }, ...(current ? { effort: "low" as const } : {}) },
      };
      let content: { type: string; text?: string }[];
      let stopReason: string | null;
      try {
        const response = current
          ? await anthropic.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }, { signal })
          : await anthropic.messages.create(params, { signal });
        content = response.content;
        stopReason = response.stop_reason;
      } catch (error) {
        explain(error, options.model);
      }
      if (stopReason === "refusal") throw new ChatProviderError("Claude declined this request. Rephrase it and try again.");
      const text = content
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("");
      return { text, proposal: parseJsonAnswer(text) };
    },
  };
}

// Settings' Test: the key works and the model exists, without spending tokens.
export async function testAnthropic(options: AnthropicOptions): Promise<ChatConnectionReport> {
  try {
    const model = await client({ ...options, timeoutMs: Math.min(options.timeoutMs, 15_000) }).models.retrieve(options.model);
    return { ok: true, message: `The key works and ${model.display_name || model.id} is available.` };
  } catch (error) {
    try {
      explain(error, options.model);
    } catch (explained) {
      if (explained instanceof ChatProviderError) return { ok: false, message: explained.message };
    }
    return { ok: false, message: "Anthropic could not be reached." };
  }
}
