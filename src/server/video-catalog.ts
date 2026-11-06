import { eq } from "drizzle-orm";
import { listVideoModels } from "llm-models/browser";
import { rendersFromText, videoPricePerSecond, type VideoModel } from "llm-models/video";

import type { ModelCapabilities } from "~/modules/generation";
import { CATALOG_PROVIDERS, modelConfigs, sanitizeDefaults, type CatalogProviderId } from "~/modules/models";
import type { Db } from "~/server/db/types";

// The video models of OpenRouter, the AI Gateway, xAI, Google and Replicate,
// as llm-models lists them (fal.ai's have their own catalog: fal-catalog.ts).

// The lists change a few times a week: one read per quarter of an hour.
const TTL_MS = 15 * 60_000;

export class VideoCatalogError extends Error {}

export interface VideoCatalogEntry {
  provider: CatalogProviderId;
  id: string;
  name: string;
  owner: string;
  released: string | null;
  durations: number[];
  aspectRatios: string[];
  resolutions: string[];
  audio: boolean | null;
  // Dollars per second at the model's first resolution, with sound when it has some.
  pricePerSecondUsd: number | null;
  // Why Troupe cannot add it, when it cannot.
  unavailable: string | null;
}

let cached: { at: number; key: string; models: VideoModel[] } | null = null;

// Keys only widen the list (Google's own Veo models, Replicate's collection).
export async function listCatalogVideoModels(
  keys: { google?: string; replicate?: string },
  options: { now?: number; fetch?: typeof fetch } = {},
): Promise<VideoModel[]> {
  const now = options.now ?? Date.now();
  const cacheKey = `${keys.google ? "g" : ""}${keys.replicate ? "r" : ""}`;
  if (cached && cached.key === cacheKey && now - cached.at < TTL_MS) return cached.models;
  const models = await listVideoModels({
    providers: CATALOG_PROVIDERS,
    ...(keys.google ? { googleApiKey: keys.google } : {}),
    ...(keys.replicate ? { replicateApiToken: keys.replicate } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  if (!models.length) throw new VideoCatalogError("No video model list could be reached. Try again in a moment.");
  cached = { at: now, key: cacheKey, models };
  return models;
}

export function forgetVideoCatalog() {
  cached = null;
}

const RATIO = /^\d+:\d+$/;

// The settings Troupe drives a model with, or why it cannot.
export function capabilitiesOf(
  model: VideoModel,
): { ok: true; caps: ModelCapabilities } | { ok: false; reason: string } {
  if (!rendersFromText(model)) return { ok: false, reason: "This model does not render from a text prompt." };
  const aspectRatios = (model.aspectRatios ?? []).filter((r) => RATIO.test(r));
  const durationsS = (model.durations ?? []).filter((d) => Number.isInteger(d) && d > 0);
  if (!aspectRatios.length || !durationsS.length)
    return { ok: false, reason: "Its provider does not list the formats and lengths it renders." };
  return {
    ok: true,
    caps: {
      aspectRatios,
      resolutions: model.resolutions?.length ? model.resolutions : ["720p"],
      durationsS,
      // Sound it can render is sound the launch can turn off: providers take the flag.
      audio: model.audio ? "optional" : "none",
      dialogueLanguages: null,
    },
  };
}

export function toCatalogEntry(model: VideoModel): VideoCatalogEntry {
  const described = capabilitiesOf(model);
  return {
    provider: model.provider as CatalogProviderId,
    id: model.id,
    name: model.name,
    owner: model.owner,
    released: model.released ?? null,
    durations: model.durations ?? [],
    aspectRatios: model.aspectRatios ?? [],
    resolutions: model.resolutions ?? [],
    audio: model.audio,
    pricePerSecondUsd: videoPricePerSecond(model, {
      resolution: model.resolutions?.[0],
      ...(model.audio ? { audio: true } : {}),
    }),
    unavailable: described.ok ? null : described.reason,
  };
}

// The model key of a catalog model: stable, readable, within 80 characters.
export const catalogModelKey = (provider: CatalogProviderId, id: string) =>
  `${provider}-${id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`.slice(0, 80);

// Add a model from a provider's list, with the settings it lists. Adding it
// again brings it back (and refreshes what was read).
export async function addCatalogVideoModel(
  db: Db,
  input: { provider: CatalogProviderId; id: string; models: readonly VideoModel[] },
): Promise<{ modelKey: string; label: string }> {
  const model = input.models.find((m) => m.provider === input.provider && m.id === input.id);
  if (!model) throw new VideoCatalogError(`${input.provider} lists no video model ${input.id}.`);
  const described = capabilitiesOf(model);
  if (!described.ok) throw new VideoCatalogError(described.reason);
  const { caps } = described;
  const defaults = sanitizeDefaults(caps, null);
  const price = videoPricePerSecond(model, {
    resolution: defaults.resolution,
    ...(caps.audio === "optional" ? { audio: true } : {}),
  });
  const modelKey = catalogModelKey(input.provider, input.id);
  const row = {
    family: "catalog" as const,
    label: model.name,
    capabilities: caps,
    connection: { provider: input.provider, model: model.id, owner: model.owner },
    defaults,
    pricePerSecondUsd: price === null ? null : String(price),
    archived: false,
    enabled: true,
    updatedAt: new Date(),
  };
  const [existing] = await db.select({ id: modelConfigs.id }).from(modelConfigs).where(eq(modelConfigs.id, modelKey));
  if (existing) await db.update(modelConfigs).set(row).where(eq(modelConfigs.id, modelKey));
  else await db.insert(modelConfigs).values({ id: modelKey, ...row });
  return { modelKey, label: model.name };
}
