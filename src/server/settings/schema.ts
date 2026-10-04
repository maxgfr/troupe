import { createTable } from "~/server/db/table";

// Private server configuration. No RLS policies grant browser roles access.
// Only the server database connection may read or write provider credentials.
export const providerSettings = createTable("provider_settings", (d) => ({
  provider: d.text({ enum: ["google", "fal", "anthropic"] }).primaryKey(),
  // Legacy plaintext column: migrated to apiKeyCiphertext on first read.
  apiKey: d.text(),
  // AES-256-GCM (src/server/settings/secrets.ts). A row with neither value
  // explicitly disables the provider, even when the environment sets a key.
  apiKeyCiphertext: d.text(),
  keyFingerprint: d.text(),
})).enableRLS();
