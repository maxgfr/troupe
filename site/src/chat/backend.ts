import { getChatSettings, type ChatBackend, type ChatSettingsView, type ChatSetup } from "~/modules/chat";
import type { Db } from "~/server/db/types";
import { createOpenRouterChat, DEFAULT_OPENROUTER_CHAT_MODEL, testOpenRouter } from "~/server/chat/openrouter";
import { readCredentials } from "~/server/settings/providers";
import { CHAT_CONFIG } from "./env";
import { chatModelCached, chatSupport, webllmChat } from "./webllm";

// The browser edition's ctx.chat: OpenRouter with the visitor's own key,
// called from this page, or WebLLM on this tab's GPU. A page on the web
// cannot reach an Ollama on the visitor's machine, and Anthropic's API does
// not take calls from a page, so neither is offered. Settings are saved in
// this browser's database, like the rest of Settings.

const WEBLLM_LABEL = "This browser";
const OPENROUTER_LABEL = "OpenRouter";

// The longest one OpenRouter answer may take; the request's own cap below
// covers loading the WebLLM model the first time.
const OPENROUTER_TIMEOUT_MS = 180_000;

async function openrouterKey(db: Db): Promise<string | null> {
  try {
    const c = (await readCredentials(db)).openrouter;
    return c.source === "saved" || c.source === "environment" ? c.key : null;
  } catch {
    return null;
  }
}

export function createBrowserChat(db: Db): ChatBackend {
  async function resolve(): Promise<ChatSetup> {
    const [saved, key] = await Promise.all([getChatSettings(db), openrouterKey(db)]);
    // A quarter of an hour covers loading the model the first time.
    const common = {
      instructions: saved.instructions ?? CHAT_CONFIG.instructions,
      wordsPerSecond: saved.wordsPerSecond ?? CHAT_CONFIG.wordsPerSecond,
      historyTurns: CHAT_CONFIG.historyTurns,
      sendTimeoutMs: 15 * 60_000,
    };
    // Automatic: OpenRouter once its key is saved, else this browser's model.
    const choice = saved.provider ?? "auto";
    const useOpenRouter = choice === "openrouter" || (choice !== "webllm" && key !== null);
    if (useOpenRouter) {
      const modelId = saved.openrouterModel ?? DEFAULT_OPENROUTER_CHAT_MODEL;
      return {
        ...common,
        provider: "openrouter",
        label: OPENROUTER_LABEL,
        modelId,
        model: key ? createOpenRouterChat({ apiKey: key, model: modelId, timeoutMs: OPENROUTER_TIMEOUT_MS }) : null,
        problem: key
          ? null
          : "The chat is set to OpenRouter but no OpenRouter API key is saved in this browser. Add one under Provider accounts, or switch the chat to this browser's model.",
      };
    }
    const support = await chatSupport();
    if (!support.ok)
      return {
        ...common,
        provider: "webllm",
        label: WEBLLM_LABEL,
        modelId: CHAT_CONFIG.model,
        model: null,
        problem: key
          ? support.detail
          : `${support.detail} Or save an OpenRouter key under Provider accounts: the chat then answers through OpenRouter.`,
      };
    return {
      ...common,
      provider: "webllm",
      label: WEBLLM_LABEL,
      modelId: support.model,
      model: webllmChat(support.model),
      problem: null,
    };
  }

  return {
    offers: ["openrouter", "webllm"],
    load: resolve,
    async settings(): Promise<ChatSettingsView> {
      const [saved, setup] = await Promise.all([getChatSettings(db), resolve()]);
      return {
        offers: ["openrouter", "webllm"],
        saved: {
          provider: saved.provider,
          openrouterModel: saved.openrouterModel,
          instructions: saved.instructions,
          wordsPerSecond: saved.wordsPerSecond,
        },
        defaults: {
          provider: "auto",
          ollamaUrl: "",
          ollamaModel: "",
          anthropicModel: "",
          openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL,
          instructions: CHAT_CONFIG.instructions,
          wordsPerSecond: CHAT_CONFIG.wordsPerSecond,
          webllmModel: CHAT_CONFIG.model,
        },
        active: { provider: setup.provider, label: setup.label, modelId: setup.modelId, problem: setup.problem },
      };
    },
    async test(provider) {
      if (provider === "openrouter") {
        const [saved, key] = await Promise.all([getChatSettings(db), openrouterKey(db)]);
        if (!key)
          return {
            ok: false,
            message: "No OpenRouter API key is saved in this browser. Add one under Provider accounts.",
          };
        return testOpenRouter({
          apiKey: key,
          model: saved.openrouterModel ?? DEFAULT_OPENROUTER_CHAT_MODEL,
          timeoutMs: 15_000,
        });
      }
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
