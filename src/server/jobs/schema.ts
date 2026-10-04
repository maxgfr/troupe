import { createTable } from "~/server/db/table";

// The reconciler's liveness beacon. A scheduler runs the polling
// safety net on a schedule (pg_cron / Vercel cron / a curl loop); with no
// visible heartbeat the first sign of a dead scheduler is a job timing out
// 30 min later. One upserted singleton row records the last successful run so
// Workspace Settings can surface its age and warn when it goes stale.
// Server-only: RLS on, no policy — the service role writes/reads it, the
// authenticated role never touches it directly.
export const reconcileHeartbeat = createTable("reconcile_heartbeat", (d) => ({
  id: d.text().primaryKey(),
  ranAt: d.timestamp({ withTimezone: true }).notNull(),
  processed: d.integer().notNull().default(0),
})).enableRLS();

// The heartbeat is a singleton — one row, upserted every run.
export const RECONCILE_HEARTBEAT_ID = "singleton";
