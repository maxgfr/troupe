import { getChatSettings, type ChatBackend, type ChatSettingsView, type ChatSetup } from "~/modules/chat";
import type { Db } from "~/server/db/types";
import { CHAT_CONFIG } from "./env";
import { chatModelCached, chatSupport, webllmChat } from "./webllm";

// The browser edition's ctx.chat: WebLLM only. API keys need a server to keep
// them, and a page on the web cannot reach an Ollama on the visitor's
// machine, so the other providers are not offered. Tone and speaking rate are
// saved in this browser's database, like the rest of Settings.

const LABEL = "This browser";

export function createBrowserChat(db: Db): ChatBackend {
  async function resolve(): Promise<ChatSetup> {
    const [saved, support] = await Promise.all([getChatSettings(db), chatSupport()]);
    const common = { instructions: saved.instructions ?? CHAT_CONFIG.instructions, wordsPerSecond: saved.wordsPerSecond ?? CHAT_CONFIG.wordsPerSecond, historyTurns: CHAT_CONFIG.historyTurns };
    if (!support.ok) return { ...common, provider: "webllm", label: LABEL, modelId: CHAT_CONFIG.model, model: null, problem: support.detail };
    return { ...common, provider: "webllm", label: LABEL, modelId: support.model, model: webllmChat(support.model), problem: null };
  }

  return {
    offers: ["webllm"],
    load: resolve,
    async settings(): Promise<ChatSettingsView> {
      const [saved, setup] = await Promise.all([getChatSettings(db), resolve()]);
      return {
        offers: ["webllm"],
        saved: { instructions: saved.instructions, wordsPerSecond: saved.wordsPerSecond },
        defaults: { provider: undefined, ollamaUrl: "", ollamaModel: "", anthropicModel: "", instructions: CHAT_CONFIG.instructions, wordsPerSecond: CHAT_CONFIG.wordsPerSecond, webllmModel: CHAT_CONFIG.model },
        active: { provider: "webllm", label: LABEL, modelId: setup.modelId, problem: setup.problem },
      };
    },
    async test() {
      const support = await chatSupport();
      if (!support.ok) return { ok: false, message: support.detail };
      const cached = await chatModelCached(support.model);
      return {
        ok: true,
        message: cached
          ? `The chat runs in this tab on the GPU, and ${support.model} is already in this browser.`
          : `The chat runs in this tab on the GPU. The first message downloads ${support.model}${CHAT_CONFIG.downloadMb ? ` (about ${CHAT_CONFIG.downloadMb} MB)` : ""} and keeps it in this browser.`,
      };
    },
  };
}
