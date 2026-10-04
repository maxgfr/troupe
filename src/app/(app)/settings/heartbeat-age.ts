import type { ReconcileHeartbeat } from "~/server/jobs/heartbeat";

// The background check runs every 30 seconds; a beat older than 5 minutes means
// the scheduler has likely stalled and the safety net is not running.
export const RECONCILE_STALE_AFTER_MS = 5 * 60_000;

export interface HeartbeatView {
  ageLabel: string;
  stale: boolean;
}

export function describeHeartbeat(beat: ReconcileHeartbeat | null, now: Date): HeartbeatView | null {
  if (!beat) return null;
  const ms = Math.max(0, now.getTime() - beat.ranAt.getTime());
  return { ageLabel: relativeAge(ms), stale: ms > RECONCILE_STALE_AFTER_MS };
}

function relativeAge(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
