import { effectiveDefaultModel, getDefaultModelKey, listModelConfigs, resolveCatalog, type ModelCatalog } from "~/modules/models";
import type { Db } from "~/server/db/types";

// The demo's model catalog. Cloud models need API keys kept on a server and
// local models a server that can reach them, so none can launch here yet:
// each says why instead of asking for a key it could never use.

export const CLOUD_IN_DEMO = "Not available in the browser demo: cloud models need the self-hosted studio to keep your API key.";
export const LOCAL_IN_DEMO = "Not available in the browser demo: local model servers need the self-hosted studio.";

export async function loadDemoCatalog(db: Db): Promise<ModelCatalog> {
  const [rows, savedDefault] = await Promise.all([listModelConfigs(db), getDefaultModelKey(db)]);
  const models = resolveCatalog({
    rows,
    credentials: { google: "none", fal: "none" },
    checkLocal: () => ({ status: "unsupported-host", detail: LOCAL_IN_DEMO }),
  }).map((model) => (model.kind === "cloud" ? { ...model, status: "unsupported-host" as const, statusDetail: CLOUD_IN_DEMO } : model));
  return { models, adapters: new Map(), defaultModelKey: effectiveDefaultModel(models, savedDefault) };
}
