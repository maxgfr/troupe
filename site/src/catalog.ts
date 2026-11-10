import {
  BROWSER_CAPABILITIES,
  BROWSER_MODEL_KEY,
  BROWSER_MODEL_LABEL,
  createBrowserAdapter,
  type VideoProviderAdapter,
} from "~/modules/generation";
import {
  effectiveDefaultModel,
  getDefaultModelKey,
  listModelConfigs,
  modelConfigs,
  parseCatalogConnection,
  resolveCatalog,
  type ModelCatalog,
} from "~/modules/models";
import type { Db } from "~/server/db/types";
import { createCatalogAdapter } from "~/server/catalog-adapter";
import { readCredentials } from "~/server/settings/providers";
import { loadActorReference } from "./shims/actor-pictures";
import { RENDER_CONFIG } from "./render/env";
import { browserRenderer } from "./render/runner";
import { renderSupport } from "./render/support";

// The browser edition's model catalog: its own model (Kokoro voices and the
// shared scene, rendered in this browser, site/src/render) and the cloud
// models added from OpenRouter's catalog, which render on the visitor's own
// OpenRouter key, called straight from this page (OpenRouter answers web
// pages: CORS). Other cloud providers and local model servers need the
// self-hosted studio, and each says why.

export const CLOUD_NEEDS_SELF_HOSTED =
  "In your browser, cloud models run on OpenRouter. This one needs the self-hosted studio, which calls its provider from your own server.";
export const LOCAL_NEEDS_SELF_HOSTED =
  "Needs the self-hosted studio, which reaches model servers on your machine or network.";

// A render stuck for longer than this is failed (a closed tab is caught sooner).
const BROWSER_TIMEOUT_S = 30 * 60;

// The browser model is a row like any local model, so Settings can turn it
// off and keep its defaults. Its capabilities follow the code.
export async function ensureBrowserModel(db: Db): Promise<void> {
  const owned = {
    family: "browser" as const,
    label: BROWSER_MODEL_LABEL,
    capabilities: BROWSER_CAPABILITIES,
    connection: {},
  };
  await db
    .insert(modelConfigs)
    .values({ id: BROWSER_MODEL_KEY, ...owned, timeoutS: BROWSER_TIMEOUT_S })
    .onConflictDoUpdate({ target: modelConfigs.id, set: { ...owned, updatedAt: new Date() } });
}

async function buildCatalog(db: Db): Promise<ModelCatalog> {
  const [rows, savedDefault, support, credentials] = await Promise.all([
    listModelConfigs(db),
    getDefaultModelKey(db),
    renderSupport(),
    readCredentials(db, {}),
  ]);
  const openrouter = credentials.openrouter;
  const onOpenRouter = (row: (typeof rows)[number]) =>
    row.family === "catalog" && parseCatalogConnection(row.connection)?.provider === "openrouter";
  const models = resolveCatalog({
    rows,
    credentials: { google: "none", fal: "none", openrouter: openrouter.source },
    checkLocal: (row) => {
      // OpenRouter's models go by their key, like any cloud model.
      if (onOpenRouter(row)) return null;
      if (row.family !== "browser") return { status: "unsupported-host", detail: LOCAL_NEEDS_SELF_HOSTED };
      return support.ok ? null : { status: "unsupported-host", detail: support.detail };
    },
  }).map((model) => {
    const row = rows.find((r) => r.id === model.key);
    return model.kind === "cloud" && !(row && onOpenRouter(row))
      ? { ...model, status: "unsupported-host" as const, statusDetail: CLOUD_NEEDS_SELF_HOSTED }
      : model;
  });
  // The adapter stays even when the model is off, so renders in flight finish.
  const adapters = new Map<string, VideoProviderAdapter>([
    [BROWSER_MODEL_KEY, createBrowserAdapter({ renderer: browserRenderer, fps: RENDER_CONFIG.fps })],
  ]);
  if (openrouter.source === "saved")
    for (const row of rows) {
      const connection = onOpenRouter(row) ? parseCatalogConnection(row.connection) : null;
      if (!connection || !row.capabilities) continue;
      adapters.set(
        row.id,
        createCatalogAdapter({
          model: {
            modelKey: row.id,
            provider: "openrouter",
            modelId: connection.model,
            capabilities: row.capabilities,
            ...(connection.frameImages ? { frameImages: connection.frameImages } : {}),
            ...(connection.talking ? { talking: true } : {}),
          },
          apiKey: openrouter.key,
          loadReference: loadActorReference,
        }),
      );
    }
  return { models, adapters, defaultModelKey: effectiveDefaultModel(models, savedDefault) };
}

// Every tRPC call needs the catalog, and it only changes when a mutation
// does (Settings): read it once, again after mutations, here or in another tab.
let cached: { db: Db; catalog: Promise<ModelCatalog> } | undefined;
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("troupe-catalog");
channel?.addEventListener("message", () => {
  cached = undefined;
});

export function loadBrowserCatalog(db: Db): Promise<ModelCatalog> {
  if (cached?.db === db) return cached.catalog;
  const catalog = buildCatalog(db);
  cached = { db, catalog };
  catalog.catch(() => {
    if (cached?.catalog === catalog) cached = undefined;
  });
  return catalog;
}

export function forgetBrowserCatalog(): void {
  cached = undefined;
  channel?.postMessage("changed");
}
