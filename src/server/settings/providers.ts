import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "~/server/db/types";
import { providerSettings } from "./schema";
import { SecretUnavailableError, loadSecretBox, type SecretBox } from "./secrets";

// "anthropic" is the script chat's key (src/server/chat/anthropic.ts).
export const CREDENTIAL_IDS = ["google", "fal", "anthropic"] as const;
export type CredentialId = (typeof CREDENTIAL_IDS)[number];

// The first one set wins. GEMINI_API_KEY and GOOGLE_API_KEY are the names
// Google's own SDKs read.
export const ENV_KEYS: Record<CredentialId, readonly string[]> = {
  google: ["GOOGLE_GENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"],
  fal: ["FAL_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
};

export function environmentKey(id: CredentialId, env: Record<string, string | undefined>): string | undefined {
  for (const name of ENV_KEYS[id]) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export type CredentialState =
  | { source: "saved"; key: string }
  | { source: "environment"; key: string }
  // A saved row with no key: the provider is off even if the environment sets one.
  | { source: "disabled" }
  | { source: "none" }
  // Sealed with a key this installation no longer has: ask for it again.
  | { source: "undecryptable" };

const aad = (provider: CredentialId) => `provider_settings:${provider}`;

function tryBox(): SecretBox | null {
  try {
    return loadSecretBox();
  } catch {
    return null;
  }
}

// `env` is where environment keys come from (tests and callers with their
// own settings pass one); saved keys always come from the database.
export async function readCredentials(
  db: Db,
  env: Record<string, string | undefined> = process.env,
): Promise<Record<CredentialId, CredentialState>> {
  const rows = await db.select().from(providerSettings);
  const box = tryBox();
  const out = {} as Record<CredentialId, CredentialState>;
  for (const id of CREDENTIAL_IDS) {
    const row = rows.find((r) => r.provider === id);
    const fromEnv = environmentKey(id, env);
    if (!row) {
      out[id] = fromEnv ? { source: "environment", key: fromEnv } : { source: "none" };
      continue;
    }
    if (row.apiKeyCiphertext) {
      if (!box || row.keyFingerprint !== box.fingerprint) {
        out[id] = { source: "undecryptable" };
        continue;
      }
      try {
        out[id] = { source: "saved", key: box.open(row.apiKeyCiphertext, aad(id)) };
      } catch (error) {
        if (!(error instanceof SecretUnavailableError)) throw error;
        out[id] = { source: "undecryptable" };
      }
      continue;
    }
    if (row.apiKey) {
      // Plaintext from an older version: seal it now, then forget the clear text.
      if (box) {
        await db
          .update(providerSettings)
          .set({ apiKey: null, apiKeyCiphertext: box.seal(row.apiKey, aad(id)), keyFingerprint: box.fingerprint })
          .where(eq(providerSettings.provider, id));
      }
      out[id] = { source: "saved", key: row.apiKey };
      continue;
    }
    if (row.apiKey === "")
      await db.update(providerSettings).set({ apiKey: null }).where(eq(providerSettings.provider, id));
    out[id] = { source: "disabled" };
  }
  return out;
}

export async function effectiveProviderKeys(db: Db): Promise<Partial<Record<CredentialId, string>>> {
  const credentials = await readCredentials(db);
  const keys: Partial<Record<CredentialId, string>> = {};
  for (const id of CREDENTIAL_IDS) {
    const c = credentials[id];
    if (c.source === "saved" || c.source === "environment") keys[id] = c.key;
  }
  return keys;
}

export const ApiKey = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .regex(/^[^\r\n]*$/);

export async function saveProviderKey(input: { provider: CredentialId; key: string }, db: Db) {
  const key = ApiKey.parse(input.key);
  const box = loadSecretBox();
  const values = {
    apiKey: null,
    apiKeyCiphertext: box.seal(key, aad(input.provider)),
    keyFingerprint: box.fingerprint,
  };
  await db
    .insert(providerSettings)
    .values({ provider: input.provider, ...values })
    .onConflictDoUpdate({ target: providerSettings.provider, set: values });
}

// "remove" forgets the saved key (an environment key applies again);
// "disable" turns the provider off even when the environment sets a key.
export async function clearProviderKey(input: { provider: CredentialId; mode: "remove" | "disable" }, db: Db) {
  if (input.mode === "remove") {
    await db.delete(providerSettings).where(eq(providerSettings.provider, input.provider));
    return;
  }
  const values = { apiKey: null, apiKeyCiphertext: null, keyFingerprint: null };
  await db
    .insert(providerSettings)
    .values({ provider: input.provider, ...values })
    .onConflictDoUpdate({ target: providerSettings.provider, set: values });
}

export type CredentialStatus = Record<CredentialId, { configured: boolean; source: CredentialState["source"] }>;

export async function credentialStatus(db: Db): Promise<CredentialStatus> {
  const credentials = await readCredentials(db);
  const out = {} as CredentialStatus;
  for (const id of CREDENTIAL_IDS) {
    const source = credentials[id].source;
    out[id] = { configured: source === "saved" || source === "environment", source };
  }
  return out;
}
