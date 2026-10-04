import { getChatSettings, type ChatBackend, type ChatProviderId, type ChatSettings, type ChatSettingsView, type ChatSetup } from "~/modules/chat";
import type { Db } from "~/server/db/types";
import { readCredentials } from "~/server/settings/providers";
import { checkLocalUrl } from "~/server/settings/urls";
import { createAnthropicChat, DEFAULT_ANTHROPIC_MODEL, testAnthropic } from "./anthropic";
import { createOllamaChat, testOllama } from "./ollama";

// The self-hosted studio's chat: Ollama unless an Anthropic key is set, both
// configurable in Settings, with defaults from the environment (.env.example).

type Env = Record<string, string | undefined>;

export const DEFAULT_OLLAMA_MODEL = "qwen3:4b";
// The script module's own estimate (2.5 words a second).
export const DEFAULT_WORDS_PER_SECOND = 2.5;

export interface ChatEnvironment {
  provider: "auto" | "ollama" | "anthropic";
  ollamaUrl: string;
  ollamaModel: string;
  anthropicModel: string;
  instructions: string;
  wordsPerSecond: number;
  timeoutMs: number;
}

const number = (raw: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number(raw);
  return raw?.trim() && Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

// src/env.js rejects bad values at startup; here a bad one falls back.
export function chatEnvironment(env: Env = process.env): ChatEnvironment {
  const provider = env.TROUPE_CHAT_PROVIDER?.trim();
  return {
    provider: provider === "ollama" || provider === "anthropic" ? provider : "auto",
    // docker-compose.yml points this at the host (host.docker.internal).
    ollamaUrl: env.OLLAMA_URL?.trim() || "http://127.0.0.1:11434",
    ollamaModel: env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL,
    anthropicModel: env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL,
    instructions: env.TROUPE_CHAT_INSTRUCTIONS?.trim() ?? "",
    wordsPerSecond: number(env.TROUPE_CHAT_WORDS_PER_SECOND, DEFAULT_WORDS_PER_SECOND, 1, 5),
    timeoutMs: number(env.TROUPE_CHAT_TIMEOUT_S, 180, 10, 1800) * 1000,
  };
}

const LABELS: Record<ChatProviderId, string> = { ollama: "Ollama", anthropic: "Claude", webllm: "This browser" };

export interface ServerChatOptions {
  env?: Env;
  fetch?: typeof fetch;
  anthropicBaseURL?: string;
}

export function createServerChat(db: Db, options: ServerChatOptions = {}): ChatBackend {
  const env = chatEnvironment(options.env);

  async function resolve() {
    const [saved, credentials] = await Promise.all([getChatSettings(db), readCredentials(db)]);
    const anthropic = credentials.anthropic;
    const anthropicKey = anthropic.source === "saved" || anthropic.source === "environment" ? anthropic.key : null;
    const settings: Required<Omit<ChatSettings, "provider">> & { provider: ChatSettings["provider"] } = {
      provider: saved.provider ?? env.provider,
      ollamaUrl: saved.ollamaUrl ?? env.ollamaUrl,
      ollamaModel: saved.ollamaModel ?? env.ollamaModel,
      anthropicModel: saved.anthropicModel ?? env.anthropicModel,
      instructions: saved.instructions ?? env.instructions,
      wordsPerSecond: saved.wordsPerSecond ?? env.wordsPerSecond,
    };
    const provider: "ollama" | "anthropic" = settings.provider === "auto" || !settings.provider ? (anthropicKey ? "anthropic" : "ollama") : settings.provider;
    return { saved, settings, provider, anthropicKey };
  }

  function setupFor(r: Awaited<ReturnType<typeof resolve>>): ChatSetup {
    const common = { instructions: r.settings.instructions, wordsPerSecond: r.settings.wordsPerSecond };
    if (r.provider === "anthropic") {
      const modelId = r.settings.anthropicModel;
      if (!r.anthropicKey) {
        return { ...common, provider: "anthropic", label: LABELS.anthropic, modelId, model: null, problem: "The chat is set to Claude but no Anthropic API key is saved. Add one under Provider accounts, or switch the chat to Ollama." };
      }
      return { ...common, provider: "anthropic", label: LABELS.anthropic, modelId, model: createAnthropicChat({ apiKey: r.anthropicKey, model: modelId, timeoutMs: env.timeoutMs, baseURL: options.anthropicBaseURL }), problem: null };
    }
    const modelId = r.settings.ollamaModel;
    const url = checkLocalUrl(r.settings.ollamaUrl);
    if (!url.ok) return { ...common, provider: "ollama", label: LABELS.ollama, modelId, model: null, problem: `The Ollama address is not allowed: ${url.reason}` };
    return { ...common, provider: "ollama", label: LABELS.ollama, modelId, model: createOllamaChat({ baseUrl: url.base, model: modelId, timeoutMs: env.timeoutMs, fetch: options.fetch }), problem: null };
  }

  return {
    offers: ["ollama", "anthropic"],
    async load() {
      return setupFor(await resolve());
    },
    async settings(): Promise<ChatSettingsView> {
      const r = await resolve();
      const setup = setupFor(r);
      return {
        offers: ["ollama", "anthropic"],
        saved: r.saved,
        defaults: { provider: env.provider, ollamaUrl: env.ollamaUrl, ollamaModel: env.ollamaModel, anthropicModel: env.anthropicModel, instructions: env.instructions, wordsPerSecond: env.wordsPerSecond },
        active: { provider: setup.provider, label: setup.label, modelId: setup.modelId, problem: setup.problem },
      };
    },
    async test(provider) {
      const r = await resolve();
      if (provider === "anthropic") {
        if (!r.anthropicKey) return { ok: false, message: "No Anthropic API key is saved. Add one under Provider accounts." };
        return testAnthropic({ apiKey: r.anthropicKey, model: r.settings.anthropicModel, timeoutMs: env.timeoutMs, baseURL: options.anthropicBaseURL });
      }
      if (provider === "ollama") return testOllama({ baseUrl: r.settings.ollamaUrl, model: r.settings.ollamaModel, timeoutMs: env.timeoutMs, fetch: options.fetch });
      return { ok: false, message: "The self-hosted studio has no in-browser model." };
    },
  };
}
