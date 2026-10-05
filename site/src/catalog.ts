import { BROWSER_CAPABILITIES, BROWSER_MODEL_KEY, BROWSER_MODEL_LABEL, createBrowserAdapter } from "~/modules/generation";
import { effectiveDefaultModel, getDefaultModelKey, listModelConfigs, modelConfigs, resolveCatalog, type ModelCatalog } from "~/modules/models";
import type { Db } from "~/server/db/types";
import { RENDER_CONFIG } from "./render/env";
import { browserRenderer } from "./render/runner";
import { renderSupport } from "./render/support";

// The browser edition's model catalog. Cloud models need API keys kept on a
// server and local model servers a studio that can reach them, so neither
// runs here and each says why. The one model that does is the browser
// edition's own: Kokoro voices and the shared scene, rendered in this browser
// (site/src/render).

export const CLOUD_NEEDS_SELF_HOSTED = "Needs the self-hosted studio, which keeps your API key on your own server.";
export const LOCAL_NEEDS_SELF_HOSTED = "Needs the self-hosted studio, which reaches model servers on your machine or network.";

// A render stuck for longer than this is failed (a closed tab is caught sooner).
const BROWSER_TIMEOUT_S = 30 * 60;

// The browser model is a row like any local model, so Settings can turn it
// off and keep its defaults. Its capabilities follow the code.
export async function ensureBrowserModel(db: Db): Promise<void> {
  const owned = { family: "browser" as const, label: BROWSER_MODEL_LABEL, capabilities: BROWSER_CAPABILITIES, connection: {} };
  await db
    .insert(modelConfigs)
    .values({ id: BROWSER_MODEL_KEY, ...owned, timeoutS: BROWSER_TIMEOUT_S })
    .onConflictDoUpdate({ target: modelConfigs.id, set: { ...owned, updatedAt: new Date() } });
}

async function buildCatalog(db: Db): Promise<ModelCatalog> {
  const [rows, savedDefault, support] = await Promise.all([listModelConfigs(db), getDefaultModelKey(db), renderSupport()]);
  const models = resolveCatalog({
    rows,
    credentials: { google: "none", fal: "none" },
    checkLocal: (row) => {
      if (row.family !== "browser") return { status: "unsupported-host", detail: LOCAL_NEEDS_SELF_HOSTED };
      return support.ok ? null : { status: "unsupported-host", detail: support.detail };
    },
  }).map((model) => (model.kind === "cloud" ? { ...model, status: "unsupported-host" as const, statusDetail: CLOUD_NEEDS_SELF_HOSTED } : model));
  // The adapter stays even when the model is off, so renders in flight finish.
  const adapters = new Map([[BROWSER_MODEL_KEY, createBrowserAdapter({ renderer: browserRenderer, fps: RENDER_CONFIG.fps })]]);
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
