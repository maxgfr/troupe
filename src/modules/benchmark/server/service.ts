import { and, desc, eq, inArray, lt } from "drizzle-orm";

import type { Db } from "~/server/db/types";
import type { MediaLinks } from "~/server/media/store";
import { projects } from "~/modules/studio/server/schema";
import { getScript, lockScript } from "~/modules/script";
import { generations, mediaAssets, prepareGeneration, submitGeneration, type VideoProviderAdapter } from "~/modules/generation";
import { tallyWinner } from "../winner";
import { BENCHMARK_LIST_LIMIT } from "../list-limit";
import { benchmarkEntries, benchmarkRuns } from "./schema";

export interface StartBenchmarkInput {
  projectId: string;
  scriptId: string;
  models: { adapter: VideoProviderAdapter; timeoutS?: number; estimatedCostUsd?: number | null }[];
  durationS: number;
  resolution: string;
}

// Compare identical inputs across two or three models.
export async function startBenchmark(db: Db, input: StartBenchmarkInput) {
  const [project] = await db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
  if (!project) throw new Error(`project ${input.projectId} not found`);

  if (input.models.length < 2 || input.models.length > 3 || new Set(input.models.map((m) => m.adapter.modelKey)).size !== input.models.length) {
    throw new Error("Choose two or three different models to compare.");
  }
  // Persist the complete comparison first, including failed submissions. The
  // version is read and recorded under a share lock (see lockScript); a model
  // that cannot take the request rolls everything back before any call.
  const { run, brief, jobs } = await db.transaction(async (tx) => {
    const conn = tx as unknown as Db;
    await lockScript(conn, input.scriptId, "share");
    const script = await getScript(conn, input.scriptId);
    const brief = script.lines.map((l) => l.text).join(" ");
    const prepared = [];
    for (const { adapter, timeoutS, estimatedCostUsd } of input.models) {
      prepared.push(await prepareGeneration(conn, {
        projectId: input.projectId, scriptId: input.scriptId, adapter, timeoutS, estimatedCostUsd,
        tier: "draft", durationS: input.durationS, resolution: input.resolution,
      }));
    }
    const [run] = await tx.insert(benchmarkRuns).values({ workspaceId: project.workspaceId, brief }).returning();
    if (!run) throw new Error("benchmark run insert returned no row");
    const jobs = [];
    for (const job of prepared) {
      const [gen] = await tx.insert(generations).values(job.record).returning();
      const [entry] = await tx.insert(benchmarkEntries).values({ benchmarkRunId: run.id, generationId: gen!.id }).returning();
      jobs.push({ gen: gen!, entry: entry!, prepared: job });
    }
    return { run, brief, jobs };
  });
  // At most three independent requests, within one provider timeout window.
  const submissions = await Promise.allSettled(jobs.map((job) => submitGeneration(db, job.gen, job.prepared)));
  const failure = submissions.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return { id: run.id, brief, entries: jobs.map(({ gen, entry }) => ({ id: entry.id, generationId: gen.id, modelKey: gen.modelKey })) };
}

// Integer votes 1–5, stored per generation entry.
export async function voteOnEntry(db: Db, input: { entryId: string; userId: string; score: number }) {
  if (!Number.isInteger(input.score) || input.score < 1 || input.score > 5) {
    throw new Error(`Rate between 1 and 5 (got ${input.score}).`);
  }
  const [entry] = await db.select().from(benchmarkEntries).where(eq(benchmarkEntries.id, input.entryId)).limit(1);
  if (!entry) throw new Error(`benchmark entry ${input.entryId} not found`);
  const votes = { ...entry.qualityVotes, [input.userId]: input.score };
  await db.update(benchmarkEntries).set({ qualityVotes: votes }).where(eq(benchmarkEntries.id, input.entryId));
}

export interface BenchmarkEntryView {
  id: string;
  generationId: string;
  modelKey: string;
  modelId: string;
  status: string;
  costUsd: number | null;
  costSource: "estimate" | "provider" | null;
  latencyMs: number | null;
  durationS: number;
  // The saved video's real length, once saved.
  mediaDurationS: number | null;
  outputAssetUrl: string | null;
  // The model drew the captions into the picture.
  burnedCaptions: boolean;
  votes: Record<string, number>;
  meanScore: number | null;
}

export interface BenchmarkRunSummary {
  id: string;
  brief: string;
  createdAt: Date;
  entryCount: number;
  // Tie-aware: null both when nobody voted and when the top score is
  // shared — a tie must never silently crown an entry.
  winnerModelKey: string | null;
}

// The workspace's runs, newest first, with brief, entry count and the
// tie-aware vote winner. Bounded — default page BENCHMARK_LIST_LIMIT, older
// pages via a strict createdAt cursor (`before`).
export async function listBenchmarkRuns(
  db: Db,
  workspaceId: string,
  opts?: { limit?: number; before?: Date },
): Promise<BenchmarkRunSummary[]> {
  const runs = await db
    .select()
    .from(benchmarkRuns)
    .where(
      and(
        eq(benchmarkRuns.workspaceId, workspaceId),
        opts?.before ? lt(benchmarkRuns.createdAt, opts.before) : undefined,
      ),
    )
    .orderBy(desc(benchmarkRuns.createdAt))
    .limit(opts?.limit ?? BENCHMARK_LIST_LIMIT);
  if (runs.length === 0) return [];

  const entries = await db
    .select()
    .from(benchmarkEntries)
    .where(inArray(benchmarkEntries.benchmarkRunId, runs.map((r) => r.id)));
  const generationIds = entries.map((e) => e.generationId);
  const gens = generationIds.length
    ? await db
        .select({ id: generations.id, modelKey: generations.modelKey })
        .from(generations)
        .where(inArray(generations.id, generationIds))
    : [];
  const modelByGeneration = new Map(gens.map((g) => [g.id, g.modelKey]));

  return runs.map((run) => {
    const runEntries = entries
      .filter((e) => e.benchmarkRunId === run.id)
      .map((e) => ({
        id: e.id,
        modelKey: modelByGeneration.get(e.generationId) ?? "unknown",
        votes: e.qualityVotes,
      }));
    const { winnerId } = tallyWinner(runEntries);
    return {
      id: run.id,
      brief: run.brief,
      createdAt: run.createdAt,
      entryCount: runEntries.length,
      winnerModelKey: winnerId ? (runEntries.find((e) => e.id === winnerId)?.modelKey ?? null) : null,
    };
  });
}

const realLength = (seconds: number | undefined) => (seconds !== undefined && Number.isFinite(seconds) && seconds > 0 ? seconds : null);

// Side-by-side view — cost, latency, votes, per-model means;
// failed entries stay visible next to completed ones.
export async function getBenchmarkRun(db: Db, runId: string, media: MediaLinks) {
  const [run] = await db.select().from(benchmarkRuns).where(eq(benchmarkRuns.id, runId)).limit(1);
  if (!run) throw new Error(`benchmark run ${runId} not found`);
  const rows = await db.select().from(benchmarkEntries).where(eq(benchmarkEntries.benchmarkRunId, runId));

  const entries: BenchmarkEntryView[] = [];
  // The run itself only stores workspace+brief; every entry's generation
  // carries the project the run was launched from and the script it rendered.
  // One bounded inArray instead of a SELECT per entry (same recipe
  // as listBenchmarkRuns); rows keep insertion order so projectId/scriptId
  // still come from the first entry that resolves a generation.
  const generationIds = rows.map((e) => e.generationId);
  const gens = generationIds.length
    ? await db.select().from(generations).where(inArray(generations.id, generationIds))
    : [];
  const genById = new Map(gens.map((g) => [g.id, g]));
  // Each saved video's real length (a model may make it longer than asked).
  const assetIds = gens.map((g) => g.outputAssetId).filter((id): id is string => Boolean(id));
  const assets = assetIds.length ? await db.select({ id: mediaAssets.id, meta: mediaAssets.meta }).from(mediaAssets).where(inArray(mediaAssets.id, assetIds)) : [];
  const lengthByAsset = new Map(assets.map((a) => [a.id, Number(a.meta.durationS)]));
  let projectId: string | null = null;
  let scriptId: string | null = null;
  for (const e of rows) {
    const gen = genById.get(e.generationId);
    if (!gen) continue;
    projectId ??= gen.projectId;
    scriptId ??= gen.scriptId;
    const votes = Object.values(e.qualityVotes);
    entries.push({
      id: e.id,
      generationId: e.generationId,
      modelKey: gen.modelKey,
      modelId: gen.modelId,
      status: gen.status,
      costUsd: gen.costUsd === null ? null : Number(gen.costUsd),
      costSource: gen.costSource,
      latencyMs: gen.completedAt ? gen.completedAt.getTime() - gen.createdAt.getTime() : null,
      durationS: gen.durationS,
      mediaDurationS: realLength(gen.outputAssetId ? lengthByAsset.get(gen.outputAssetId) : undefined),
      outputAssetUrl: gen.outputAssetId ? media.urlFor(gen.outputAssetId) : null,
      burnedCaptions: gen.burnedCaptions,
      votes: e.qualityVotes,
      meanScore: votes.length ? votes.reduce((a, b) => a + b, 0) / votes.length : null,
    });
  }

  const meanByModel: Record<string, number> = {};
  for (const modelKey of new Set(entries.map((e) => e.modelKey))) {
    const scored = entries.filter((e) => e.modelKey === modelKey && e.meanScore !== null);
    if (scored.length) meanByModel[modelKey] = scored.reduce((a, e) => a + e.meanScore!, 0) / scored.length;
  }
  let briefLines: string[] | null = null;
  if (scriptId) {
    try {
      briefLines = (await getScript(db, scriptId)).lines.map((l) => l.text);
    } catch {
      briefLines = null; // a deleted script degrades to the joined brief
    }
  }

  return { id: run.id, projectId, brief: run.brief, briefLines, entries, meanByModel };
}
