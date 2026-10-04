import { describe, expect, it } from "vitest";

import { createTestDb } from "~/test/db";
import { getReconcileHeartbeat, recordReconcileHeartbeat } from "./heartbeat";

// A singleton row proving the reconciler ran, so Workspace
// Settings can show its age instead of leaving the operator blind.
describe("reconcile heartbeat", () => {
  it("is null before the reconciler has ever reported", async () => {
    const t = await createTestDb();
    expect(await getReconcileHeartbeat(t.db)).toBeNull();
  });

  it("records the last run and reads it back", async () => {
    const t = await createTestDb();
    const at = new Date("2026-07-21T10:00:00Z");
    await recordReconcileHeartbeat(t.db, { at, processed: 3 });
    const beat = await getReconcileHeartbeat(t.db);
    expect(beat?.ranAt.toISOString()).toBe(at.toISOString());
    expect(beat?.processed).toBe(3);
  });

  it("upserts the singleton — a later run overwrites, never a second row", async () => {
    const t = await createTestDb();
    await recordReconcileHeartbeat(t.db, { at: new Date("2026-07-21T10:00:00Z"), processed: 1 });
    const later = new Date("2026-07-21T10:01:00Z");
    await recordReconcileHeartbeat(t.db, { at: later, processed: 5 });
    const beat = await getReconcileHeartbeat(t.db);
    expect(beat?.ranAt.toISOString()).toBe(later.toISOString());
    expect(beat?.processed).toBe(5);
  });
});
