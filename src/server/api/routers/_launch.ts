import { TRPCError } from "@trpc/server";

import type { Db } from "~/server/db/types";
import { launchGeneration } from "~/modules/generation";
import { estimateCostUsd, type ModelCatalog } from "~/modules/models";
import { ScriptTooLongError } from "~/modules/script";
import { pickLaunchAdapter } from "./_adapters";

export interface TextLaunch {
  projectId: string;
  scriptId: string;
  modelKey: string;
  durationS: number;
  resolution: string;
  audio?: boolean;
  language?: string;
}

// A render of one script version: the launch panel's button, and the chat's
// "Apply & relaunch". The script must already belong to the project. Always
// a draft: only an export makes a render final.
export function launchText(ctx: { db: Db; catalog: ModelCatalog }, input: TextLaunch) {
  const { adapter, model } = pickLaunchAdapter(ctx.catalog, input.modelKey);
  return launchGeneration(ctx.db, {
    projectId: input.projectId,
    scriptId: input.scriptId,
    adapter,
    tier: "draft",
    durationS: input.durationS,
    resolution: input.resolution,
    audio: input.audio,
    language: input.language,
    timeoutS: model.timeoutS,
    estimatedCostUsd: estimateCostUsd(model, input.durationS),
  }).catch((error: unknown) => {
    // The caller's choice to fix (a shorter script, a longer clip), not a fault.
    if (error instanceof ScriptTooLongError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    throw error;
  });
}
