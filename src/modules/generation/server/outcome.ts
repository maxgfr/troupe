import { and, eq, inArray, sql } from "drizzle-orm";

import type { Db } from "~/server/db/types";
import type { JobOutcome } from "./adapter";
import { generations, generationWatches } from "./schema";

export type OutcomeApplied = "completed" | "failed" | "duplicate";

const BILLED_FAILURES = new Set(["RECONCILE_TIMEOUT", "DOWNLOAD_FAILED"]);

// ONE place owns the terminal transition, so concurrent reconciler runs can
// never drift ("completed twice", "failed but still watched"). The
// conditional update IS the race guard: zero rows updated means another
// run already finalized this generation.
export async function applyJobOutcome(tx: Db, gen: { id: string; projectId: string }, mapped: JobOutcome): Promise<OutcomeApplied> {
  if (mapped.kind === "completed") {
    const rows = await tx
      .update(generations)
      .set({ status: "completed", errorCode: null, errorDetail: null, completedAt: new Date(), ...(mapped.costUsd !== undefined ? { costUsd: String(mapped.costUsd), costSource: "provider" as const } : {}) })
      .where(and(eq(generations.id, gen.id), inArray(generations.status, ["queued", "in_progress"])))
      .returning();
    if (rows.length === 0) return "duplicate";
    await tx.delete(generationWatches).where(eq(generationWatches.generationId, gen.id));
    return "completed";
  }

  const rows = await tx
    .update(generations)
    .set({
      status: "failed",
      errorCode: mapped.errorCode ?? "UNKNOWN",
      errorDetail: mapped.detail ?? null,
      // A failure the provider reported is not billed: drop the launch
      // estimate. After a timeout or a lost download it may have been.
      ...(BILLED_FAILURES.has(mapped.errorCode ?? "") ? {} : {
        costUsd: sql`case when ${generations.costSource} = 'estimate' then null else ${generations.costUsd} end`,
        costSource: sql`case when ${generations.costSource} = 'estimate' then null else ${generations.costSource} end`,
      }),
    })
    .where(and(eq(generations.id, gen.id), inArray(generations.status, ["queued", "in_progress"])))
    .returning();
  if (rows.length === 0) return "duplicate";
  await tx.delete(generationWatches).where(eq(generationWatches.generationId, gen.id));
  return "failed";
}
