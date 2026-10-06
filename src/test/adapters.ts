import { eq } from "drizzle-orm";

import type { Db } from "~/server/db/types";
import {
  generations,
  type CreateJobRequest,
  type JobOutcome,
  type ModelCapabilities,
  type ModelFamily,
  type ProviderJobStatus,
  type VideoProviderAdapter,
} from "~/modules/generation";
import { applyJobOutcome } from "~/modules/generation/server/outcome";
import { sanitizeDefaults, type ModelCatalog, type ResolvedModel } from "~/modules/models";

export type FakeAdapter = VideoProviderAdapter & { calls: CreateJobRequest[] };

// Permissive capabilities for test doubles: any 1–30 s clip at 720p.
export const TEST_CAPS: ModelCapabilities = {
  aspectRatios: ["9:16", "16:9"],
  resolutions: ["720p"],
  durationsS: Array.from({ length: 30 }, (_, i) => i + 1),
  audio: "optional",
  dialogueLanguages: null,
};

// A scriptable video model: records every submission and answers status polls
// with `getJob` (pending by default). Job ids are `${jobId}` or `${jobId}-<n>`.
export function fakeAdapter(
  opts: {
    modelKey?: string;
    family?: ModelFamily;
    modelId?: string;
    aspectRatios?: string[];
    capabilities?: Partial<ModelCapabilities>;
    jobId?: string;
    getJob?: (providerJobId: string) => Promise<ProviderJobStatus>;
    createJob?: (req: CreateJobRequest) => Promise<{ providerJobId: string }>;
  } = {},
): FakeAdapter {
  const calls: CreateJobRequest[] = [];
  const base = opts.jobId ?? `job-${Math.random().toString(36).slice(2)}`;
  const capabilities: ModelCapabilities = {
    ...TEST_CAPS,
    ...(opts.aspectRatios ? { aspectRatios: opts.aspectRatios } : {}),
    ...opts.capabilities,
  };
  return {
    modelKey: opts.modelKey ?? "veo",
    family: opts.family ?? "http",
    modelId: opts.modelId ?? "fake-model",
    calls,
    capabilities: () => capabilities,
    async createJob(req) {
      calls.push(req);
      if (opts.createJob) return opts.createJob(req);
      return { providerJobId: calls.length === 1 ? base : `${base}-${calls.length}` };
    },
    getJob: opts.getJob ?? (async () => ({ kind: "pending" })),
  };
}

// startBenchmark input for plain adapters.
export const asModels = (adapters: VideoProviderAdapter[]) => adapters.map((adapter) => ({ adapter }));

// A catalog where every given adapter is a ready, enabled model.
export function catalogOf(
  adapters: VideoProviderAdapter[],
  opts: { defaultModelKey?: string | null; patch?: Record<string, Partial<ResolvedModel>> } = {},
): ModelCatalog {
  const models = adapters.map(
    (a): ResolvedModel => ({
      key: a.modelKey,
      family: a.family,
      label: a.modelKey,
      vendor: "Test",
      kind: "cloud",
      credential: null,
      modelId: a.modelId,
      capabilities: a.capabilities(),
      defaults: sanitizeDefaults(a.capabilities(), null),
      pricePerSecondUsd: null,
      timeoutS: 1800,
      enabled: true,
      archived: false,
      status: "ready",
      statusDetail: null,
      lastTest: null,
      ...opts.patch?.[a.modelKey],
    }),
  );
  return {
    models,
    adapters: new Map(adapters.map((a) => [a.modelKey, a])),
    defaultModelKey: opts.defaultModelKey !== undefined ? opts.defaultModelKey : (models[0]?.key ?? null),
  };
}

// Drive a generation to a terminal state through the same transition the
// reconciler uses.
export async function finishGeneration(
  db: Db,
  generationId: string,
  outcome: Partial<JobOutcome> & { kind: JobOutcome["kind"] },
) {
  const [gen] = await db.select().from(generations).where(eq(generations.id, generationId)).limit(1);
  if (!gen) throw new Error(`generation ${generationId} not found`);
  return applyJobOutcome(db, gen, { providerJobId: gen.providerJobId ?? "", eventType: "test", ...outcome });
}
