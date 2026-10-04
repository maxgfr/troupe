import { createTable } from "~/server/db/table";
import type { ModelCapabilities } from "~/modules/generation/server/adapter";
import type { ModelDefaults } from "./resolve";

// One row per model the user touched: overrides for a built-in (enabled,
// defaults, price, timeout) or the whole definition of a local model.
// Server-only: RLS on, no policy.
export const modelConfigs = createTable("model_config", (d) => ({
  // The modelKey.
  id: d.text().primaryKey(),
  family: d.text({ enum: ["veo", "fal", "comfyui", "http", "browser"] }).notNull(),
  label: d.text(),
  enabled: d.boolean().notNull().default(true),
  archived: d.boolean().notNull().default(false),
  defaults: d.jsonb().$type<ModelDefaults>(),
  pricePerSecondUsd: d.numeric(),
  timeoutS: d.integer(),
  capabilities: d.jsonb().$type<ModelCapabilities>(),
  // Family-specific settings (base URL, workflow, bindings). Never secrets.
  connection: d.jsonb().$type<Record<string, unknown>>(),
  // A local endpoint token, sealed like provider keys.
  secretCiphertext: d.text(),
  secretFingerprint: d.text(),
  createdAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
})).enableRLS();

// Singleton studio-wide preferences.
export const studioSettings = createTable("studio_settings", (d) => ({
  id: d.integer().primaryKey().default(1),
  defaultModelKey: d.text(),
  // The script chat's provider, model and tone (src/modules/chat). Checked
  // when read, so a value from an older version cannot break the chat.
  chat: d.jsonb().$type<Record<string, unknown>>(),
  updatedAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
})).enableRLS();
