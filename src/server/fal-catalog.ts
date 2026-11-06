import { eq } from "drizzle-orm";
import { z } from "zod";

import { describeFalModel, isFalEndpoint, type HttpLike } from "~/modules/generation";
import { modelConfigs, sanitizeDefaults } from "~/modules/models";
import type { Db } from "~/server/db/types";

// fal.ai's public model API: the text-to-video catalog needs no key; a price
// needs one (and costs nothing). https://docs.fal.ai/platform-apis/v1/models
const PLATFORM = "https://api.fal.ai/v1";

// The catalog changes a few times a week: one read per quarter of an hour.
const CATALOG_TTL_MS = 15 * 60_000;
// fal pages by 100; a few pages hold every active text-to-video model.
const MAX_PAGES = 8;

const Listing = z.object({
  models: z.array(
    z.object({
      endpoint_id: z.string(),
      metadata: z
        .object({
          display_name: z.string().nullish(),
          status: z.string().nullish(),
          updated_at: z.string().nullish(),
        })
        .partial()
        .nullish(),
      openapi: z.unknown().optional(),
    }),
  ),
  next_cursor: z.string().nullish(),
  has_more: z.boolean().nullish(),
});

const Pricing = z.object({
  prices: z.array(
    z.object({ endpoint_id: z.string(), unit_price: z.number(), unit: z.string(), currency: z.string() }),
  ),
});

export interface FalCatalogEntry {
  endpoint: string;
  label: string;
  owner: string;
  updatedAt: string | null;
}

export class FalCatalogError extends Error {}

// fal.ai's platform API from this studio, with a time limit.
export const falHttp: HttpLike = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  return { ok: res.ok, status: res.status, json: () => res.json() as Promise<unknown> };
};

let cached: { at: number; entries: FalCatalogEntry[] } | null = null;

// Every active text-to-video model fal.ai lists, in its own order (its leading models first).
export async function listFalVideoModels(http: HttpLike, now = Date.now()): Promise<FalCatalogEntry[]> {
  if (cached && now - cached.at < CATALOG_TTL_MS) return cached.entries;
  const entries: FalCatalogEntry[] = [];
  let cursor: string | null | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${PLATFORM}/models?category=text-to-video&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await http(url, {});
    if (!res.ok) throw new FalCatalogError(`fal.ai's model list answered HTTP ${res.status}. Try again in a moment.`);
    const listing = Listing.safeParse(await res.json());
    if (!listing.success) throw new FalCatalogError("fal.ai's model list came back in a shape Troupe does not read.");
    for (const m of listing.data.models) {
      if (m.metadata?.status && m.metadata.status !== "active") continue;
      if (!isFalEndpoint(m.endpoint_id)) continue;
      entries.push({
        endpoint: m.endpoint_id,
        label: m.metadata?.display_name?.trim() || m.endpoint_id,
        owner: m.endpoint_id.split("/")[0]!,
        updatedAt: m.metadata?.updated_at ?? null,
      });
    }
    cursor = listing.data.next_cursor;
    if (!listing.data.has_more || !cursor) break;
  }
  cached = { at: now, entries };
  return entries;
}

export function forgetFalCatalog() {
  cached = null;
}

// The model key a catalog endpoint gets: stable, readable, within 80 characters.
export const falModelKey = (endpoint: string) =>
  `fal-${endpoint
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`.slice(0, 80);

// A name for an endpoint fal.ai gives none:
// "bytedance/seedance-2.5/text-to-video" → "Seedance 2.5".
export function labelFromEndpoint(endpoint: string): string {
  const parts = endpoint.split("/").slice(1);
  const kept = parts.filter((p) => p !== "text-to-video" && p !== "fal-ai");
  const words = (kept.length ? kept : parts)
    .join(" ")
    .replace(/[-_]+/g, " ")
    .replace(/\bv(\d)/gi, "$1")
    .trim();
  return words.replace(/\b[a-z]/g, (c) => c.toUpperCase()) || endpoint;
}

// The price per second fal.ai lists for an endpoint, when it bills by the second.
async function pricePerSecond(http: HttpLike, endpoint: string, apiKey: string | null): Promise<number | null> {
  if (!apiKey) return null;
  const res = await http(`${PLATFORM}/models/pricing?endpoint_id=${encodeURIComponent(endpoint)}`, {
    headers: { authorization: `Key ${apiKey}` },
  });
  if (!res.ok) return null;
  const price = Pricing.safeParse(await res.json()).data?.prices.find((p) => p.endpoint_id === endpoint);
  return price && price.currency === "USD" && /^seconds?$/i.test(price.unit) ? price.unit_price : null;
}

// Add an endpoint from fal.ai's catalog: read its schema, keep the settings
// Troupe can drive, and its price when the key can read it. Adding it again
// brings it back (and refreshes what was read).
export async function addFalModel(
  db: Db,
  input: { endpoint: string; http: HttpLike; apiKey: string | null },
): Promise<{ modelKey: string; label: string }> {
  if (!isFalEndpoint(input.endpoint)) throw new FalCatalogError("That is not a fal.ai model id.");
  const res = await input.http(
    `${PLATFORM}/models?endpoint_id=${encodeURIComponent(input.endpoint)}&expand=openapi-3.0`,
    {},
  );
  if (!res.ok) throw new FalCatalogError(`fal.ai answered HTTP ${res.status} for ${input.endpoint}.`);
  const found = Listing.safeParse(await res.json()).data?.models.find((m) => m.endpoint_id === input.endpoint);
  if (!found) throw new FalCatalogError(`fal.ai lists no model ${input.endpoint}.`);
  const described = describeFalModel(input.endpoint, found.openapi);
  if (!described.ok) throw new FalCatalogError(described.reason);
  const { capabilities, input: shape } = described.model;
  const label = found.metadata?.display_name?.trim() || labelFromEndpoint(input.endpoint);
  const price = await pricePerSecond(input.http, input.endpoint, input.apiKey).catch(() => null);
  const modelKey = falModelKey(input.endpoint);
  const row = {
    family: "fal" as const,
    label,
    capabilities,
    connection: shape as unknown as Record<string, unknown>,
    defaults: sanitizeDefaults(capabilities, null),
    pricePerSecondUsd: price === null ? null : String(price),
    archived: false,
    enabled: true,
    updatedAt: new Date(),
  };
  const [existing] = await db.select({ id: modelConfigs.id }).from(modelConfigs).where(eq(modelConfigs.id, modelKey));
  if (existing) await db.update(modelConfigs).set(row).where(eq(modelConfigs.id, modelKey));
  else await db.insert(modelConfigs).values({ id: modelKey, ...row });
  return { modelKey, label };
}
