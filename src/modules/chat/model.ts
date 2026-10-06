// The seam between the chat and whatever model answers it: Ollama or Claude
// in the self-hosted studio (src/server/chat), WebLLM in the browser edition
// (site/src/chat). The router only ever sees ctx.chat.

export interface ChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatAnswer {
  // The model's raw answer, shown to the user when it cannot be read.
  text: string;
  // The answer parsed as JSON (null when it is not JSON); not yet checked.
  proposal: unknown | null;
}

// The JSON schema an answer is held to: the script proposal's, or the
// inspiration library's (src/modules/library). Only the features every
// provider's constrained decoding understands (see proposal.ts).
export type AnswerSchema = { readonly type: "object"; readonly [key: string]: unknown };

export interface ChatModel {
  // `maxTokens`: a cap on the answer where the provider can honour one (Ollama
  // stops there); providers may raise it (Claude keeps room for its
  // thinking, WebLLM its configured length) or hold it to what their model
  // allows. It is a bound, never a promise of room.
  propose(
    messages: ChatTurn[],
    options: { schema: AnswerSchema; signal?: AbortSignal; maxTokens?: number },
  ): Promise<ChatAnswer>;
}

export const CHAT_PROVIDERS = ["ollama", "anthropic", "webllm"] as const;
export type ChatProviderId = (typeof CHAT_PROVIDERS)[number];

// A failure the user can act on, said in a sentence (model not pulled,
// server not running, key refused). Anything else is reported generically.
export class ChatProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatProviderError";
  }
}

// What the chat runs with for one request.
export interface ChatSetup {
  provider: ChatProviderId;
  // "Ollama", "Claude", "This browser".
  label: string;
  modelId: string;
  // Null when the provider cannot run here; `problem` says why.
  model: ChatModel | null;
  problem: string | null;
  // Added to the system prompt: the studio's tone and house rules.
  instructions: string;
  // Speaking rate used for the word budget (clip seconds × rate).
  wordsPerSecond: number;
  // Earlier turns sent with each request (default HISTORY_TURNS).
  historyTurns?: number;
  // The longest one request may take, its answer and its retry together
  // (TROUPE_CHAT_SEND_TIMEOUT_S; the browser edition's own): past it, the
  // model's calls stop and the chat says so.
  sendTimeoutMs: number;
}

export interface ChatConnectionReport {
  ok: boolean;
  message: string;
}

// Studio-wide chat preferences saved in Settings. Unset fields fall back to
// the environment (self-hosted) or the build's settings (browser edition).
export interface ChatSettings {
  provider?: "auto" | "ollama" | "anthropic";
  ollamaUrl?: string;
  ollamaModel?: string;
  anthropicModel?: string;
  instructions?: string;
  wordsPerSecond?: number;
}

// The effective value of each setting and where it comes from, for Settings.
export interface ChatSettingsView {
  // The providers this edition can use, in the order Settings lists them.
  offers: ChatProviderId[];
  saved: ChatSettings;
  defaults: Required<Omit<ChatSettings, "provider">> & { provider: ChatSettings["provider"]; webllmModel?: string };
  active: { provider: ChatProviderId; label: string; modelId: string; problem: string | null };
}

// Injected through the tRPC context (ctx.chat).
export interface ChatBackend {
  offers: ChatProviderId[];
  // Reads the settings each time: a change in Settings applies at once.
  load(): Promise<ChatSetup>;
  settings(): Promise<ChatSettingsView>;
  // Settings' Test button: reaches the provider with the saved settings.
  test(provider: ChatProviderId): Promise<ChatConnectionReport>;
}
