import { eq, sql } from "drizzle-orm";

import type { Db } from "~/server/db/types";
import type { ModelCapabilities } from "~/modules/generation/server/adapter";
import { BUILTIN_MODELS } from "./builtins";
import { randomHex } from "./random";
import type { ModelConfigRow, ModelDefaults } from "./resolve";
import { modelConfigs, studioSettings } from "./schema";

export async function listModelConfigs(db: Db): Promise<ModelConfigRow[]> {
  const rows = await db.select().from(modelConfigs);
  return rows.map(({ updatedAt: _updatedAt, ...row }) => row);
}

export async function getDefaultModelKey(db: Db): Promise<string | null> {
  const [row] = await db.select().from(studioSettings).where(eq(studioSettings.id, 1)).limit(1);
  return row?.defaultModelKey ?? null;
}

export async function setDefaultModelKey(db: Db, modelKey: string | null) {
  await db
    .insert(studioSettings)
    .values({ id: 1, defaultModelKey: modelKey })
    .onConflictDoUpdate({ target: studioSettings.id, set: { defaultModelKey: modelKey, updatedAt: new Date() } });
}

export interface ModelPreferences {
  enabled?: boolean;
  defaults?: ModelDefaults | null;
  pricePerSecondUsd?: number | null;
  timeoutS?: number | null;
}

function preferenceColumns(patch: ModelPreferences) {
  return {
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.defaults !== undefined ? { defaults: patch.defaults } : {}),
    ...(patch.pricePerSecondUsd !== undefined
      ? { pricePerSecondUsd: patch.pricePerSecondUsd === null ? null : String(patch.pricePerSecondUsd) }
      : {}),
    ...(patch.timeoutS !== undefined ? { timeoutS: patch.timeoutS } : {}),
  };
}

// Built-ins get a row on first change; local models already have one.
export async function updateModelPreferences(db: Db, modelKey: string, patch: ModelPreferences) {
  const builtin = BUILTIN_MODELS.find((m) => m.key === modelKey);
  const set = { ...preferenceColumns(patch), updatedAt: new Date() };
  if (builtin) {
    await db
      .insert(modelConfigs)
      .values({ id: modelKey, family: builtin.family, ...set })
      .onConflictDoUpdate({ target: modelConfigs.id, set });
    return;
  }
  const updated = await db
    .update(modelConfigs)
    .set(set)
    .where(eq(modelConfigs.id, modelKey))
    .returning({ id: modelConfigs.id });
  if (updated.length === 0) throw new Error(`model ${modelKey} not found`);
}

export interface LocalModelInput {
  family: "comfyui" | "http";
  label: string;
  capabilities: ModelCapabilities;
  connection: Record<string, unknown>;
  defaults?: ModelDefaults | null;
  timeoutS?: number | null;
  // Already sealed by the caller (src/server/settings/secrets.ts).
  secret?: { ciphertext: string; fingerprint: string } | null;
}

function slug(label: string) {
  return (
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32) || "model"
  );
}

export function newLocalModelKey(label: string) {
  return `local-${slug(label)}-${randomHex(3)}`;
}

// `id` lets the caller seal a secret bound to the row before inserting it.
export async function createLocalModel(db: Db, input: LocalModelInput & { id?: string }): Promise<string> {
  const id = input.id ?? newLocalModelKey(input.label);
  await db.insert(modelConfigs).values({
    id,
    family: input.family,
    label: input.label,
    capabilities: input.capabilities,
    connection: input.connection,
    defaults: input.defaults ?? null,
    timeoutS: input.timeoutS ?? null,
    secretCiphertext: input.secret?.ciphertext ?? null,
    secretFingerprint: input.secret?.fingerprint ?? null,
  });
  return id;
}

// `secret: undefined` keeps the stored token; `null` removes it.
export async function updateLocalModel(db: Db, modelKey: string, input: Partial<Omit<LocalModelInput, "family">>) {
  const updated = await db
    .update(modelConfigs)
    .set({
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.capabilities !== undefined ? { capabilities: input.capabilities } : {}),
      ...(input.connection !== undefined ? { connection: input.connection } : {}),
      ...(input.defaults !== undefined ? { defaults: input.defaults } : {}),
      ...(input.timeoutS !== undefined ? { timeoutS: input.timeoutS } : {}),
      ...(input.secret !== undefined
        ? { secretCiphertext: input.secret?.ciphertext ?? null, secretFingerprint: input.secret?.fingerprint ?? null }
        : {}),
      updatedAt: new Date(),
    })
    .where(sql`${modelConfigs.id} = ${modelKey} and ${modelConfigs.family} in ('comfyui', 'http')`)
    .returning({ id: modelConfigs.id });
  if (updated.length === 0) throw new Error(`local model ${modelKey} not found`);
}

// Archived models leave every picker but keep their history and finish
// their in-flight jobs. Built-ins can only be disabled.
export async function archiveLocalModel(db: Db, modelKey: string, archived = true) {
  const updated = await db
    .update(modelConfigs)
    .set({ archived, updatedAt: new Date() })
    .where(sql`${modelConfigs.id} = ${modelKey} and ${modelConfigs.family} in ('comfyui', 'http')`)
    .returning({ id: modelConfigs.id });
  if (updated.length === 0) throw new Error(`local model ${modelKey} not found`);
}

export async function getModelConfig(db: Db, modelKey: string) {
  const [row] = await db.select().from(modelConfigs).where(eq(modelConfigs.id, modelKey)).limit(1);
  return row ?? null;
}
