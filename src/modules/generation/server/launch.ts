import { and, eq } from "drizzle-orm";

import type { Db } from "~/server/db/types";
import { projects } from "~/modules/studio/server/schema";
import { actorAssets, actors } from "~/modules/actors/server/schema";
import { assertScriptFitsClip, getScript, lockScript } from "~/modules/script";
import { AdapterError, compilePrompt, validateRequest, type JobScript, type VideoProviderAdapter } from "./adapter";
import { generations } from "./schema";
import { watchGeneration } from "./orchestrator";

export interface LaunchInput {
  projectId: string;
  scriptId: string;
  adapter: VideoProviderAdapter;
  tier: "draft" | "final";
  durationS: number;
  resolution: string;
  // How long the job may stay unfinished (default 30 minutes).
  timeoutS?: number;
  // Price × duration from the model catalog; recorded as an estimate.
  estimatedCostUsd?: number | null;
  // Defaults to on whenever the model can speak.
  audio?: boolean;
  language?: string;
  // The failed render this launch tries again.
  parentGenerationId?: string;
}

// Validate everything and compile the prompt; nothing is written or sent yet.
export async function prepareGeneration(db: Db, input: LaunchInput) {
  const [project] = await db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
  if (!project) throw new Error("This project no longer exists.");

  const caps = input.adapter.capabilities();
  const audio = input.audio ?? caps.audio !== "none";
  validateRequest(caps, {
    aspectRatio: project.format,
    resolution: input.resolution,
    durationS: input.durationS,
    audio,
  });

  const script = await getScript(db, input.scriptId);
  if (script.projectId !== project.id) throw new Error("This script belongs to another project.");
  // Refuse a script whose spoken duration exceeds the clip BEFORE any provider call.
  assertScriptFitsClip(script, { clipLengthS: input.durationS });
  if (!project.actorId) throw new Error("Choose an actor for this project before launching.");
  const [actor] = await db.select().from(actors).where(eq(actors.id, project.actorId)).limit(1);
  if (!actor) throw new Error("The actor chosen for this project no longer exists. Choose another one.");

  const language = input.language ?? project.language;
  const prompt = compilePrompt({
    lines: script.lines,
    voiceProfile: `${actor.voiceProfile}. Appearance: adult, ${actor.gender}, ${actor.ageRange}, ${actor.style} style`,
    language,
  });
  // The pictures of the actor's current set, keyed by shot (the file's name).
  const pictures = await db
    .select({ storagePath: actorAssets.storagePath })
    .from(actorAssets)
    .where(and(eq(actorAssets.actorId, actor.id), eq(actorAssets.version, actor.assetVersion)));
  const portraits = Object.fromEntries(
    pictures.map((p) => [p.storagePath.replace(/^.*\//, "").replace(/\.[^.]+$/, ""), p.storagePath]),
  );
  const jobScript: JobScript = {
    lines: script.lines.map(({ role, text, emotion }) => ({ role, text, emotion })),
    actor: {
      id: actor.id,
      name: actor.name,
      gender: actor.gender,
      ageRange: actor.ageRange,
      voiceProfile: actor.voiceProfile,
      ...(pictures.length > 0 ? { portraits } : {}),
    },
    language,
  };

  return {
    adapter: input.adapter,
    timeoutS: input.timeoutS,
    record: {
      projectId: input.projectId,
      modelKey: input.adapter.modelKey,
      provider: input.adapter.family,
      modelId: input.adapter.modelId,
      inputMode: "text" as const,
      tier: input.tier,
      scriptId: input.scriptId,
      actorId: actor.id,
      actorAssetVersion: actor.assetVersion,
      prompt,
      aspectRatio: project.format,
      durationS: input.durationS,
      resolution: input.resolution,
      language: input.language,
      ...(input.parentGenerationId ? { parentGenerationId: input.parentGenerationId } : {}),
      ...(input.estimatedCostUsd != null
        ? { costUsd: String(input.estimatedCostUsd), costSource: "estimate" as const }
        : {}),
    },
    request: {
      prompt,
      aspectRatio: project.format,
      durationS: input.durationS,
      resolution: input.resolution,
      audio,
      script: jobScript,
    },
  };
}

// Preparation can be completed for a whole comparison before any paid call.
export async function submitGeneration(
  db: Db,
  gen: typeof generations.$inferSelect,
  prepared: Awaited<ReturnType<typeof prepareGeneration>>,
) {
  let providerJobId: string;
  try {
    ({ providerJobId } = await prepared.adapter.createJob(prepared.request));
  } catch (error) {
    const known = error instanceof AdapterError;
    const [failed] = await db
      .update(generations)
      .set({
        status: "failed",
        errorCode: known ? error.code : "SUBMIT_FAILED",
        errorDetail: known ? error.detail : "The model did not accept the job. Check its settings and try again.",
        // Nothing was rendered, so nothing was spent.
        costUsd: null,
        costSource: null,
      })
      .where(eq(generations.id, gen.id))
      .returning();
    return failed!;
  }
  // A database failure after acceptance must never masquerade as a refused
  // submission or cause another paid request. Retry only this database write.
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const [row] = await tx
          .update(generations)
          .set({ providerJobId, status: "in_progress" })
          .where(eq(generations.id, gen.id))
          .returning();
        await watchGeneration(tx as unknown as Db, {
          generationId: gen.id,
          modelKey: gen.modelKey,
          providerJobId,
          timeoutS: prepared.timeoutS,
          pollEveryS: prepared.adapter.pollEveryS,
        });
        return row!;
      });
    } catch (error) {
      if (attempt >= 2) throw error;
    }
  }
}

export async function launchGeneration(db: Db, input: LaunchInput) {
  // The version is read and recorded together, under a share lock.
  const { prepared, gen } = await db.transaction(async (tx) => {
    const conn = tx as unknown as Db;
    await lockScript(conn, input.scriptId, "share");
    const prepared = await prepareGeneration(conn, input);
    const [gen] = await tx.insert(generations).values(prepared.record).returning();
    if (!gen) throw new Error("generation insert returned no row");
    return { prepared, gen };
  });
  return submitGeneration(db, gen, prepared);
}
