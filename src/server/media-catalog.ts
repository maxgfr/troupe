import { eq } from "drizzle-orm";
import { listImageModels, listSpeechModels } from "llm-models/browser";
import { imagePrice, rendersImageFromText, type ImageModel } from "llm-models/image";
import { speechPrice, type SpeechModel } from "llm-models/speech";

import {
  listModelConfigs,
  modelConfigs,
  resolveMediaModels,
  type CredentialId,
  type MediaConnection,
  type MediaModel,
  type Medium,
} from "~/modules/models";
import type { Db } from "~/server/db/types";
import { readCredentials } from "~/server/settings/providers";

// The photo and voice models every provider offers (llm-models), and the
// ones added to the studio. Rendering them: shot-media.ts.

const TTL_MS = 15 * 60_000;

export class MediaCatalogError extends Error {}

export interface MediaCatalogEntry {
  medium: Medium;
  provider: MediaConnection["provider"];
  id: string;
  name: string;
  owner: string;
  released: string | null;
  // "1:1 16:9 · 1024x1024", "12 voices · 30 languages", when the list says.
  summary: string | null;
  price: MediaConnection["price"];
  unavailable: string | null;
}

type Listed = { image: ImageModel[]; speech: SpeechModel[] };
const cached: Partial<Record<Medium, { at: number; key: string; models: ImageModel[] | SpeechModel[] }>> = {};

export type MediaKeys = { replicate?: string; elevenlabs?: string; openai?: string; google?: string };

export async function listMediaModels<M extends Medium>(
  medium: M,
  keys: MediaKeys,
  options: { now?: number; fetch?: typeof fetch } = {},
): Promise<Listed[M]> {
  const now = options.now ?? Date.now();
  const cacheKey = Object.entries(keys)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join("+");
  const hit = cached[medium];
  if (hit && hit.key === cacheKey && now - hit.at < TTL_MS) return hit.models as Listed[M];
  const fetchOption = options.fetch ? { fetch: options.fetch } : {};
  const models =
    medium === "image"
      ? await listImageModels({
          ...fetchOption,
          ...(keys.replicate ? { replicateApiToken: keys.replicate } : {}),
          ...(keys.openai ? { openaiApiKey: keys.openai } : {}),
          ...(keys.google ? { googleApiKey: keys.google } : {}),
        })
      : await listSpeechModels({ ...fetchOption, ...(keys.elevenlabs ? { elevenLabsApiKey: keys.elevenlabs } : {}) });
  if (!models.length) throw new MediaCatalogError("No model list could be reached. Try again in a moment.");
  cached[medium] = { at: now, key: cacheKey, models };
  return models as Listed[M];
}

export function forgetMediaCatalog() {
  for (const m of ["image", "speech"] as const) delete cached[m];
}

const RATIO = /^\d+:\d+$/;

function imageConnection(m: ImageModel): MediaConnection | { unavailable: string } {
  if (!rendersImageFromText(m)) return { unavailable: "This model edits images; it does not draw from a text prompt." };
  const price = imagePrice(m, { size: m.sizes?.[0] });
  return {
    provider: m.provider,
    model: m.id,
    owner: m.owner,
    aspectRatios: (m.aspectRatios ?? []).filter((r) => RATIO.test(r)),
    sizes: m.sizes,
    price: price === null ? null : { usd: price, per: "image" },
  };
}

function speechConnection(m: SpeechModel): MediaConnection {
  const perMillion = speechPrice(m, 1_000_000);
  return {
    provider: m.provider,
    model: m.id,
    owner: m.owner,
    voices: m.voices,
    languages: m.languages,
    instructions: m.instructions,
    price: perMillion === null ? null : { usd: perMillion, per: "million-characters" },
  };
}

export function toMediaEntry(medium: Medium, m: ImageModel | SpeechModel): MediaCatalogEntry {
  const connection = medium === "image" ? imageConnection(m as ImageModel) : speechConnection(m as SpeechModel);
  const unavailable = "unavailable" in connection ? connection.unavailable : null;
  let summary: string | null;
  if (medium === "image") {
    const im = m as ImageModel;
    summary = [im.aspectRatios?.join(" "), im.sizes?.slice(0, 3).join(" ")].filter(Boolean).join(" · ") || null;
  } else {
    const sm = m as SpeechModel;
    summary =
      [
        sm.voices?.length ? `${sm.voices.length} voices` : "",
        sm.languages?.length ? `${sm.languages.length} languages` : "",
        sm.instructions ? "takes a delivery" : "",
      ]
        .filter(Boolean)
        .join(" · ") || null;
  }
  return {
    medium,
    provider: m.provider,
    id: m.id,
    name: m.name,
    owner: m.owner,
    released: m.released ?? null,
    summary,
    price: "unavailable" in connection ? null : (connection.price ?? null),
    unavailable,
  };
}

export const mediaModelKey = (medium: Medium, provider: string, id: string) =>
  `${medium === "image" ? "photo" : "voice"}-${provider}-${id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`.slice(0, 80);

// Add a photo or voice model from its provider's list. Adding it again
// brings it back and refreshes what was read.
export async function addMediaModel(
  db: Db,
  input: { medium: Medium; provider: string; id: string; models: readonly (ImageModel | SpeechModel)[] },
): Promise<{ modelKey: string; label: string }> {
  const model = input.models.find((m) => m.provider === input.provider && m.id === input.id);
  if (!model)
    throw new MediaCatalogError(
      `${input.provider} lists no ${input.medium === "image" ? "image" : "voice"} model ${input.id}.`,
    );
  const connection =
    input.medium === "image" ? imageConnection(model as ImageModel) : speechConnection(model as SpeechModel);
  if ("unavailable" in connection) throw new MediaCatalogError(connection.unavailable);
  const modelKey = mediaModelKey(input.medium, input.provider, input.id);
  const row = {
    family: input.medium,
    label: model.name,
    capabilities: null,
    connection: connection as unknown as Record<string, unknown>,
    defaults: null,
    pricePerSecondUsd: null,
    archived: false,
    enabled: true,
    updatedAt: new Date(),
  };
  const [existing] = await db.select({ id: modelConfigs.id }).from(modelConfigs).where(eq(modelConfigs.id, modelKey));
  if (existing) await db.update(modelConfigs).set(row).where(eq(modelConfigs.id, modelKey));
  else await db.insert(modelConfigs).values({ id: modelKey, ...row });
  return { modelKey, label: model.name };
}

const usable = (c: { source: string; key?: string }) =>
  c.source === "saved" || c.source === "environment" ? (c as { key: string }).key : undefined;

// The studio's photo and voice models, each with its key's status.
export async function loadMediaModels(db: Db): Promise<MediaModel[]> {
  const [rows, credentials] = await Promise.all([listModelConfigs(db), readCredentials(db)]);
  const sources = Object.fromEntries(Object.entries(credentials).map(([id, c]) => [id, c.source])) as Record<
    CredentialId,
    "saved" | "environment" | "disabled" | "none" | "undecryptable"
  >;
  return resolveMediaModels({ rows, credentials: sources });
}

// The key a model renders on, when it has one.
export async function mediaApiKey(db: Db, credential: CredentialId): Promise<string | null> {
  const c = (await readCredentials(db))[credential];
  return usable(c) ?? null;
}

// The saved keys that widen the lists (Replicate's collection, ElevenLabs' voices).
export async function mediaCatalogKeys(db: Db): Promise<MediaKeys> {
  const c = await readCredentials(db);
  return {
    replicate: usable(c.replicate),
    elevenlabs: usable(c.elevenlabs),
    openai: usable(c.openai),
    google: usable(c.google),
  };
}
