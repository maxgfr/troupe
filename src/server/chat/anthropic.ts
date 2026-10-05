import Anthropic from "@anthropic-ai/sdk";

import { ChatProviderError, parseJsonAnswer, type ChatConnectionReport, type ChatModel } from "~/modules/chat";
import { claudeCapabilities, claudeTemperature } from "./claude-models";

// Claude through the Anthropic API, with the key saved in Settings or
// ANTHROPIC_API_KEY. The answer is held to the proposal's JSON schema with
// structured outputs (output_config.format) where the model has them:
// forcing a tool call, the older way to get JSON, is refused by the current
// models. What each model is sent comes from claude-models.ts.

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  // Tests point this at a local server; ANTHROPIC_BASE_URL works too.
  baseURL?: string;
  // Sent only to models that take one (claude-models.ts), held to 0–1.
  // Unset: the model's own default.
  temperature?: number | null;
  // false keeps the server-side fallback beta out of every request, for a
  // gateway that would refuse it (index.ts decides). Unset: the model table.
  serverFallback?: boolean;
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
      const can = claudeCapabilities(options.model);
      const instructions = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      // Without structured outputs the schema is spelled out instead, and the
      // answer is checked (and repaired once) like any model's.
      const system = can.structuredOutputs ? instructions : `${instructions}\n\nAnswer with only a JSON object that follows this JSON schema, with no text around it:\n${JSON.stringify(schema)}`;
      const turns: Anthropic.MessageParam[] = messages.flatMap((m) => (m.role === "system" ? [] : [{ role: m.role, content: m.content }]));
      const params = {
        model: options.model,
        // Room for adaptive thinking and a 20-line script.
        max_tokens: 8000,
        system,
        messages: turns,
        ...(can.structuredOutputs || can.effort
          ? { output_config: { ...(can.structuredOutputs ? { format: { type: "json_schema" as const, schema: schema as unknown as Record<string, unknown> } } : {}), ...(can.effort ? { effort: "low" as const } : {}) } }
          : {}),
        ...(can.temperature && options.temperature != null ? { temperature: claudeTemperature(options.temperature) } : {}),
      };
      let content: { type: string; text?: string }[];
      let stopReason: string | null;
      try {
        const response = can.serverFallback && options.serverFallback !== false
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
