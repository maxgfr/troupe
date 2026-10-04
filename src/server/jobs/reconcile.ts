import { timingSafeEqual } from "node:crypto";

import type { JobOrchestrator } from "~/modules/generation";

// Constant-time secret comparison (a plain !== leaks length/prefix timing).
function secretMatches(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// HTTP trigger for the reconciler — any scheduler (pg_cron, Vercel
// cron, a curl loop) POSTs here every minute. Fail-closed: unconfigured means
// 503, a wrong secret means 401, and neither runs a single poll.
export async function processReconcileRequest(
  deps: {
    orchestrator: Pick<JobOrchestrator, "reconcileDue">;
    secret?: string;
    // Persist a liveness beacon after each authorized run so Workspace
    // Settings can show the reconciler's age. Optional — the fail-closed guards
    // below never write one, and the pure tests don't need a db.
    recordHeartbeat?: (run: { at: Date; processed: number }) => Promise<void>;
  },
  req: { secret: string | null },
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!deps.secret) {
    return { status: 503, body: { error: "job reconciliation is not configured — set RECONCILE_SECRET" } };
  }
  if (!secretMatches(req.secret, deps.secret)) {
    return { status: 401, body: { error: "invalid reconcile secret" } };
  }
  const results = await deps.orchestrator.reconcileDue({ limit: 1 });
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  // One structured line per run — greppable ops signal without a
  // metrics stack.
  console.info(JSON.stringify({ event: "jobs.reconcile", processed: results.length, counts }));
  await deps.recordHeartbeat?.({ at: new Date(), processed: results.length });
  return { status: 200, body: { processed: results.length, counts } };
}
