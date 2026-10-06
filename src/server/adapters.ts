import "server-only";

import { createFalAdapter, createVeoTextAdapter, type HttpLike, type VideoProviderAdapter } from "~/modules/generation";
import {
  builtinModels,
  effectiveDefaultModel,
  getDefaultModelKey,
  listModelConfigs,
  resolveCatalog,
  type BuiltinModel,
  type ModelCatalog,
  type ModelStatus,
} from "~/modules/models";
import { db as runtimeDb } from "~/server/db";
import type { Db } from "~/server/db/types";
import { readCredentials } from "~/server/settings/providers";
import { localAdapterFromRow } from "~/server/local-models";

export const httpFetch: HttpLike = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  return { ok: res.ok, status: res.status, json: () => res.json() as Promise<unknown> };
};

export function builtinAdapter(model: BuiltinModel, apiKey: string, http: HttpLike = httpFetch): VideoProviderAdapter {
  if (model.family === "veo") {
    return createVeoTextAdapter({
      model: { modelKey: model.key, modelId: model.modelId, capabilities: model.capabilities },
      http,
      apiKey,
    });
  }
  return createFalAdapter({
    model: {
      modelKey: model.key,
      endpoint: model.modelId,
      capabilities: model.capabilities,
      sendsResolution: model.sendsResolution ?? false,
      promptMaxChars: model.promptMaxChars,
    },
    http,
    apiKey,
  });
}

export async function loadModelCatalog(db: Db = runtimeDb): Promise<ModelCatalog> {
  const [credentials, rows, savedDefault] = await Promise.all([
    readCredentials(db),
    listModelConfigs(db),
    getDefaultModelKey(db),
  ]);
  const adapters = new Map<string, VideoProviderAdapter>();
  const builtins = builtinModels(process.env);
  for (const model of builtins) {
    const credential = credentials[model.credential];
    if (credential.source === "saved" || credential.source === "environment")
      adapters.set(model.key, builtinAdapter(model, credential.key));
  }
  const builtinKeys = new Set(builtins.map((m) => m.key));
  const vetoes = new Map<string, { status: ModelStatus; detail: string }>();
  for (const row of rows) {
    if (builtinKeys.has(row.id)) continue;
    const built = localAdapterFromRow(row);
    if (!built) vetoes.set(row.id, { status: "invalid", detail: `No adapter for ${row.family} models.` });
    else if ("createJob" in built) adapters.set(row.id, built);
    else vetoes.set(row.id, built);
  }
  const models = resolveCatalog({
    rows,
    credentials: { google: credentials.google.source, fal: credentials.fal.source },
    checkLocal: (row) => vetoes.get(row.id) ?? null,
    builtins,
  });
  return { models, adapters, defaultModelKey: effectiveDefaultModel(models, savedDefault) };
}
