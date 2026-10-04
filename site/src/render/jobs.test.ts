import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { installFakeLocks } from "./fake-locks";
import { clearJobs, failInterruptedJobs, holdJobLock, INTERRUPTED, jobState, pruneJobs, readJob, saveJob, updateJob, type JobRecord } from "./jobs";

const job = { width: 720, height: 1280, fps: 24, script: { lines: [], actor: { id: "a", name: "A", gender: "female" as const, ageRange: "25-34", voiceProfile: "warm" }, language: "en" } };
const record = (id: string, patch: Partial<JobRecord> = {}): JobRecord => ({ id, status: "running", job, createdAt: Date.now(), ...patch });

beforeEach(async () => {
  installFakeLocks();
  await clearJobs();
});

describe("render jobs", () => {
  it("leaves a job alone while its tab holds the lock, and fails it once the tab is gone", async () => {
    const release = await holdJobLock("j1");
    await saveJob(record("j1"));
    expect(await jobState("j1")).toEqual({ status: "running" });

    release();
    expect(await jobState("j1")).toEqual({ status: "failed", detail: INTERRUPTED });
    expect(await readJob("j1")).toMatchObject({ status: "failed", detail: INTERRUPTED });
  });

  it("never fails a job whose tab wrote the outcome before letting go of the lock", async () => {
    const release = await holdJobLock("j2");
    await saveJob(record("j2"));
    await updateJob("j2", { status: "succeeded" });
    release();
    expect(await jobState("j2")).toEqual({ status: "succeeded" });
  });

  it("only fails a job that is still unfinished when the failure is written", async () => {
    await saveJob(record("j3", { status: "succeeded" }));
    await updateJob("j3", { status: "failed", detail: INTERRUPTED }, ["queued", "running"]);
    expect(await readJob("j3")).toMatchObject({ status: "succeeded" });
  });

  it("knows no job the browser does not have", async () => {
    expect(await jobState("nothing")).toBeNull();
  });

  it("fails, on load, only the unfinished jobs no tab is rendering", async () => {
    await holdJobLock("alive");
    await saveJob(record("alive"));
    await saveJob(record("orphan", { status: "queued" }));
    await saveJob(record("done", { status: "succeeded" }));
    await failInterruptedJobs();
    expect((await readJob("alive"))?.status).toBe("running");
    expect(await readJob("orphan")).toMatchObject({ status: "failed", detail: INTERRUPTED });
    expect((await readJob("done"))?.status).toBe("succeeded");
  });

  it("forgets finished jobs once the studio has settled them, and only those", async () => {
    const hourAgo = Date.now() - 2 * 60 * 60_000;
    await saveJob(record("stored", { status: "succeeded" }));
    await saveJob(record("not-yet-stored", { status: "succeeded" }));
    await saveJob(record("failed", { status: "failed", detail: "x" }));
    await saveJob(record("unknown-new", { status: "failed", detail: "x" }));
    await saveJob(record("unknown-old", { status: "succeeded", createdAt: hourAgo }));
    await saveJob(record("running"));
    let asked: string[] = [];
    await pruneJobs(async (ids) => {
      asked = ids;
      return new Map([
        ["stored", "settled"],
        ["not-yet-stored", "pending"],
        ["failed", "settled"],
      ] as const);
    });
    expect(asked.sort()).toEqual(["failed", "not-yet-stored", "stored", "unknown-new", "unknown-old"]);
    expect(await readJob("stored")).toBeUndefined();
    expect(await readJob("failed")).toBeUndefined();
    expect(await readJob("unknown-old")).toBeUndefined();
    expect(await readJob("not-yet-stored")).toBeDefined();
    expect(await readJob("unknown-new")).toBeDefined();
    expect(await readJob("running")).toBeDefined();
  });
});
