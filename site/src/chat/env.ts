import { parseChatConfig, type BrowserChatConfig } from "./config";

// The chat's settings for this build (site/.env.example), checked by the
// build against WebLLM's model list and handed over as one constant
// (site/vite.config.ts). Tests run without the build: defaults then.
declare const __CHAT_CONFIG__: BrowserChatConfig | undefined;

export const CHAT_CONFIG: BrowserChatConfig = typeof __CHAT_CONFIG__ === "undefined" ? parseChatConfig({}) : __CHAT_CONFIG__;
