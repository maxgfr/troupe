import { eq } from "drizzle-orm";

import type { Db } from "~/server/db/types";
import { RECONCILE_HEARTBEAT_ID, reconcileHeartbeat } from "./schema";

export interface ReconcileHeartbeat {
  ranAt: Date;
  processed: number;
}

// The reconcile route calls this after every authorized run — one
// upserted singleton row, so a dead scheduler shows up as a stale heartbeat
// instead of a silent gap.
export async function recordReconcileHeartbeat(db: Db, run: { at: Date; processed: number }): Promise<void> {
  await db
    .insert(reconcileHeartbeat)
    .values({ id: RECONCILE_HEARTBEAT_ID, ranAt: run.at, processed: run.processed })
    .onConflictDoUpdate({
      target: reconcileHeartbeat.id,
      set: { ranAt: run.at, processed: run.processed },
    });
}

export async function getReconcileHeartbeat(db: Db): Promise<ReconcileHeartbeat | null> {
  const [row] = await db
    .select()
    .from(reconcileHeartbeat)
    .where(eq(reconcileHeartbeat.id, RECONCILE_HEARTBEAT_ID))
    .limit(1);
  return row ? { ranAt: row.ranAt, processed: row.processed } : null;
}
