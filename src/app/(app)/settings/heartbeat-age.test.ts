import { describe, expect, it } from "vitest";

import { RECONCILE_STALE_AFTER_MS, describeHeartbeat } from "./heartbeat-age";

const now = new Date("2026-07-21T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

// The operator reads the reconciler's age; a heartbeat older
// than the stale threshold means the scheduler may be down.
describe("describeHeartbeat", () => {
  it("returns null when the reconciler has never reported", () => {
    expect(describeHeartbeat(null, now)).toBeNull();
  });

  it("labels a fresh beat and marks it healthy", () => {
    const beat = describeHeartbeat({ ranAt: ago(30_000), processed: 4 }, now);
    expect(beat).toEqual({ ageLabel: "30s ago", stale: false });
  });

  it("labels minutes and stays healthy under the threshold", () => {
    expect(describeHeartbeat({ ranAt: ago(4 * 60_000), processed: 0 }, now)?.stale).toBe(false);
    expect(describeHeartbeat({ ranAt: ago(4 * 60_000), processed: 0 }, now)?.ageLabel).toBe("4m ago");
  });

  it("marks stale once older than the 5-minute threshold", () => {
    expect(RECONCILE_STALE_AFTER_MS).toBe(5 * 60_000);
    expect(describeHeartbeat({ ranAt: ago(RECONCILE_STALE_AFTER_MS), processed: 0 }, now)?.stale).toBe(false);
    expect(describeHeartbeat({ ranAt: ago(RECONCILE_STALE_AFTER_MS + 1_000), processed: 0 }, now)?.stale).toBe(true);
  });
});
