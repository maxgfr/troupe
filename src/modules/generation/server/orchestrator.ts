import { and, asc, eq, lt, lte } from "drizzle-orm";

import type { Db } from "~/server/db/types";
import type { JobOutcome, ProviderJobStatus, VideoProviderAdapter } from "./adapter";
import { applyJobOutcome } from "./outcome";
import { generations, generationWatches } from "./schema";

// Poll every 20 s with backoff, until the job ends or its deadline passes. A
// model that sets pollEveryS is polled at that steady pace instead.
export const FIRST_POLL_DELAY_S = 20;
const MAX_BACKOFF_S = 300;
export const DEFAULT_TIMEOUT_S = 30 * 60;
// A launch recorded but never acknowledged by the provider.
const SUBMISSION_TIMEOUT_MS = DEFAULT_TIMEOUT_S * 1000;
const DOWNLOAD_GRACE_MS = 24 * 60 * 60 * 1000;

export function pollBackoffS(attempts: number, pollEveryS?: number): number {
  if (pollEveryS) return pollEveryS;
  return Math.min(FIRST_POLL_DELAY_S * 2 ** attempts, MAX_BACKOFF_S);
}

// Adapters by modelKey. Disabled or archived models stay in here so their
// in-flight jobs are still followed to the end.
export type AdapterLookup = ReadonlyMap<string, VideoProviderAdapter> | readonly VideoProviderAdapter[];

function lookup(adapters: AdapterLookup, modelKey: string) {
  return "get" in adapters ? adapters.get(modelKey) : adapters.find((a) => a.modelKey === modelKey);
}

export interface WatchInput {
  generationId: string;
  modelKey: string;
  providerJobId: string;
  timeoutS?: number;
  // The adapter's own polling pace (VideoProviderAdapter.pollEveryS).
  pollEveryS?: number;
  now?: Date;
}

// Arm the polling fallback for a submitted job. Idempotent — re-arming an
// already-watched generation is a no-op (the first schedule wins).
export async function watchGeneration(db: Db, input: WatchInput): Promise<void> {
  const now = input.now ?? new Date();
  await db
    .insert(generationWatches)
    .values({
      generationId: input.generationId,
      modelKey: input.modelKey,
      providerJobId: input.providerJobId,
      nextPollAt: new Date(now.getTime() + pollBackoffS(0, input.pollEveryS) * 1000),
      deadlineAt: new Date(now.getTime() + (input.timeoutS ?? DEFAULT_TIMEOUT_S) * 1000),
    })
    .onConflictDoNothing();
}

export type RenderIngestor = (db: Db, generation: typeof generations.$inferSelect, status: JobOutcome, adapter: VideoProviderAdapter) => Promise<void>;

export interface ReconcileResult {
  generationId: string;
  outcome: "completed" | "failed" | "timeout-failed" | "pending" | "already-terminal";
}

// The reconciler: claim due watches (FOR UPDATE SKIP LOCKED — concurrent
// runners never double-poll a row), ask the provider, and finalize through the
// applyJobOutcome. A provider status endpoint that
// errors counts as pending: one flaky provider must not sink the batch.
export async function reconcileDueJobs(
  db: Db,
  input: { adapters: AdapterLookup; now?: Date; limit?: number; ingest?: RenderIngestor },
): Promise<ReconcileResult[]> {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 20;
  return db.transaction(async (tx) => {
    // A process can stop between recording a submission and saving its job ID.
    // Never resubmit automatically: the provider may already have charged it.
    const abandoned = await tx.update(generations)
      .set({ status: "failed", errorCode: "SUBMISSION_UNKNOWN", completedAt: now })
      .where(and(eq(generations.status, "queued"), lt(generations.createdAt, new Date(now.getTime() - SUBMISSION_TIMEOUT_MS))))
      .returning({ generationId: generations.id });
    const due = await tx
      .select()
      .from(generationWatches)
      .where(lte(generationWatches.nextPollAt, now))
      .orderBy(asc(generationWatches.nextPollAt))
      .limit(limit)
      .for("update", { skipLocked: true });

    const results: ReconcileResult[] = abandoned.map((row) => ({ ...row, outcome: "timeout-failed" }));
    for (const watch of due) {
      const [gen] = await tx.select().from(generations).where(eq(generations.id, watch.generationId)).limit(1);
      if (!gen || gen.status === "completed" || gen.status === "failed") {
        await tx.delete(generationWatches).where(eq(generationWatches.generationId, watch.generationId));
        results.push({ generationId: watch.generationId, outcome: "already-terminal" });
        continue;
      }

      const adapter = lookup(input.adapters, watch.modelKey);
      let status: ProviderJobStatus = { kind: "pending" };
      if (adapter?.getJob) {
        try {
          status = await adapter.getJob(watch.providerJobId);
        } catch {
          status = { kind: "pending" };
        }
      }

      // The provider already finished (and billed) when only saving failed.
      let downloadPending = gen.errorCode === "DOWNLOAD_RETRY";
      if (status.kind === "completed" && input.ingest && adapter) {
        try {
          const completed = status;
          // A failed SQL write aborts its transaction. A savepoint lets the
          // outer queue transaction still schedule a download retry.
          await tx.transaction((savepoint) => input.ingest!(savepoint as unknown as Db, gen, completed, adapter));
        } catch {
          // Keep the job watched: retry the download, never the paid generation.
          await tx.update(generations).set({ errorCode: "DOWNLOAD_RETRY" }).where(eq(generations.id, gen.id));
          status = { kind: "pending" };
          downloadPending = true;
        }
      }

      if (status.kind !== "pending") {
        const applied = await applyJobOutcome(tx as unknown as Db, gen, status);
        results.push({ generationId: gen.id, outcome: applied === "duplicate" ? "already-terminal" : applied });
        continue;
      }

      // A finished render keeps retrying its download for a day past the
      // deadline: timing it out would invite a second paid launch.
      if (downloadPending && now.getTime() > watch.deadlineAt.getTime() + DOWNLOAD_GRACE_MS) {
        await applyJobOutcome(tx as unknown as Db, gen, {
          providerJobId: watch.providerJobId,
          kind: "failed",
          eventType: "reconcile.download",
          errorCode: "DOWNLOAD_FAILED",
          detail: "The model finished this video but it could not be downloaded. Get it from the provider's dashboard instead of relaunching.",
        });
        results.push({ generationId: gen.id, outcome: "timeout-failed" });
        continue;
      }

      if (!downloadPending && now.getTime() > watch.deadlineAt.getTime()) {
        // No zombie in_progress — a job past its deadline is marked failed,
        // whatever the provider might still be doing.
        await applyJobOutcome(tx as unknown as Db, gen, {
          providerJobId: watch.providerJobId,
          kind: "failed",
          eventType: "reconcile.timeout",
          errorCode: "RECONCILE_TIMEOUT",
        });
        results.push({ generationId: gen.id, outcome: "timeout-failed" });
        continue;
      }

      const attempts = watch.attempts + 1;
      await tx
        .update(generationWatches)
        .set({ attempts, nextPollAt: new Date(now.getTime() + pollBackoffS(attempts, adapter?.pollEveryS) * 1000) })
        .where(eq(generationWatches.generationId, watch.generationId));
      results.push({ generationId: gen.id, outcome: "pending" });
    }
    return results;
  });
}

// The port: the app talks to an orchestrator, not to a vendor.
export interface JobOrchestrator {
  watch(input: WatchInput): Promise<void>;
  reconcileDue(input?: { now?: Date; limit?: number }): Promise<ReconcileResult[]>;
}

// Default driver: the in-repo Postgres reconciliation queue. Zero external
// vendor, same guarantees.
export function createPgOrchestrator(deps: { db: Db; adapters: AdapterLookup; ingest?: RenderIngestor }): JobOrchestrator {
  return {
    watch: (input) => watchGeneration(deps.db, input),
    reconcileDue: (input) => reconcileDueJobs(deps.db, { adapters: deps.adapters, ingest: deps.ingest, ...input }),
  };
}
