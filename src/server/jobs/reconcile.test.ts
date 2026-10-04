import { describe, expect, it, vi } from "vitest";

import type { JobOrchestrator, ReconcileResult } from "~/modules/generation";
import { processReconcileRequest } from "./reconcile";

function fakeOrchestrator(results: ReconcileResult[]): JobOrchestrator {
  return { watch: async () => undefined, reconcileDue: async () => results };
}

describe("reconcile trigger — fail-closed HTTP guard", () => {
  it("503 when RECONCILE_SECRET is not configured — never runs unauthenticated", async () => {
    const res = await processReconcileRequest({ orchestrator: fakeOrchestrator([]), secret: undefined }, { secret: "anything" });
    expect(res.status).toBe(503);
  });

  it("401 on a wrong secret", async () => {
    const res = await processReconcileRequest({ orchestrator: fakeOrchestrator([]), secret: "s3cret" }, { secret: "wrong" });
    expect(res.status).toBe(401);
  });

  it("200 with per-outcome counts on the right secret", async () => {
    const res = await processReconcileRequest(
      {
        orchestrator: fakeOrchestrator([
          { generationId: "a", outcome: "completed" },
          { generationId: "b", outcome: "pending" },
          { generationId: "c", outcome: "pending" },
        ]),
        secret: "s3cret",
      },
      { secret: "s3cret" },
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ processed: 3, counts: { completed: 1, pending: 2 } });
  });

  it("records a heartbeat with the processed count only on an authorized run", async () => {
    const record = vi.fn((_run: { at: Date; processed: number }) => Promise.resolve());
    const ok = await processReconcileRequest(
      { orchestrator: fakeOrchestrator([{ generationId: "a", outcome: "completed" }, { generationId: "b", outcome: "pending" }]), secret: "s3cret", recordHeartbeat: record },
      { secret: "s3cret" },
    );
    expect(ok.status).toBe(200);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]![0]).toMatchObject({ processed: 2 });
    expect(record.mock.calls[0]![0].at).toBeInstanceOf(Date);
  });

  it("never records a heartbeat when the guard fails closed (503/401)", async () => {
    const record = vi.fn((_run: { at: Date; processed: number }) => Promise.resolve());
    await processReconcileRequest({ orchestrator: fakeOrchestrator([]), secret: undefined, recordHeartbeat: record }, { secret: "x" });
    await processReconcileRequest({ orchestrator: fakeOrchestrator([]), secret: "s3cret", recordHeartbeat: record }, { secret: "wrong" });
    expect(record).not.toHaveBeenCalled();
  });

  it("logs one structured ops line {event, processed, counts} on a successful run", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      await processReconcileRequest(
        { orchestrator: fakeOrchestrator([{ generationId: "a", outcome: "failed" }]), secret: "s3cret" },
        { secret: "s3cret" },
      );
      expect(info).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(String(info.mock.calls[0]![0])) as Record<string, unknown>;
      expect(parsed).toEqual({ event: "jobs.reconcile", processed: 1, counts: { failed: 1 } });
    } finally {
      info.mockRestore();
    }
  });
});
