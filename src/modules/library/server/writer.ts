import type { ChatModel, ChatTurn } from "~/modules/chat";

// The chat model the library writes with (the script chat's), and one
// answer in a schema with one more try when it cannot be read.

export interface Writer {
  model: ChatModel;
  provider: string;
  modelId: string;
}

// One answer in the schema, with one more try when it cannot be read.
export async function ask<T>(writer: Writer, turns: ChatTurn[], schema: Parameters<ChatModel["propose"]>[1]["schema"], read: (raw: unknown) => T | null, options: { signal?: AbortSignal; maxTokens?: number; repair?: string }): Promise<{ text: string; value: T | null }> {
  const first = await writer.model.propose(turns, { schema, signal: options.signal, maxTokens: options.maxTokens });
  const firstValue = first.proposal === null ? null : read(first.proposal);
  if (firstValue !== null) return { text: first.text, value: firstValue };
  const second = await writer.model.propose(
    [...turns, { role: "assistant", content: first.text }, { role: "user", content: options.repair ?? "That answer cannot be used: it does not follow the JSON schema. Answer again with only the JSON object, following the same rules." }],
    { schema, signal: options.signal, maxTokens: options.maxTokens },
  );
  const secondValue = second.proposal === null ? null : read(second.proposal);
  return { text: second.text.trim() || first.text.trim(), value: secondValue };
}
