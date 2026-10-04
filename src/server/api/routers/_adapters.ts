import { TRPCError } from "@trpc/server";

import type { VideoProviderAdapter } from "~/modules/generation";
import type { ModelCatalog, ResolvedModel } from "~/modules/models";

// Pick a model that may start a new job, or explain in one sentence why not.
// Polling uses catalog.adapters directly: disabled models still finish.
export function pickLaunchAdapter(catalog: ModelCatalog, modelKey: string): { adapter: VideoProviderAdapter; model: ResolvedModel } {
  const model = catalog.models.find((m) => m.key === modelKey);
  const fail = (message: string): never => {
    throw new TRPCError({ code: "BAD_REQUEST", message });
  };
  if (!model) return fail(`The model "${modelKey}" no longer exists. Choose another one.`);
  if (model.archived) return fail(`${model.label} is archived. Choose another model.`);
  if (!model.enabled) return fail(`${model.label} is turned off in Settings.`);
  if (model.status !== "ready") return fail(model.statusDetail ?? `${model.label} is not ready. Check it in Settings.`);
  const adapter = catalog.adapters.get(modelKey);
  if (!adapter) return fail(`${model.label} is not configured. Check it in Settings.`);
  return { adapter, model };
}
