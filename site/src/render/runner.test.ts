import "fake-indexeddb/auto";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { BrowserRenderJob } from "~/modules/generation";
import { installFakeLocks, type FakeLockManager } from "./fake-locks";
import { clearJobs, readJob, type JobRecord } from "./jobs";
import type { FromWorker, ToWorker } from "./protocol";

// The page side of the renderer, with the worker, the browser checks and the
// <video> probe replaced: what it writes to IndexedDB, and in which order
// against the job's lock.

vi.mock("./support", () => ({ renderSupport: async () => ({ ok: true, device: "webgpu", detail: "ok" }) }));
const probe = vi.hoisted(() => ({ fail: false }));
vi.mock("./probe", () => ({
  readVideo: async (blob: Blob) => {
    if (probe.fail) throw new Error("This browser cannot play the video it rendered.");
    return { probe: { durationS: 5, width: 720, height: 1280 }, checksum: `sha-of-${blob.size}` };
  },
}));

// The outcomes whose write to IndexedDB has finished, in order: the release
// hook reads it synchronously, so a lock let go before the write is caught.
const written = vi.hoisted(() => new Set<string>());
vi.mock("./jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./jobs")>();
  return {
    ...actual,
    updateJob: async (...args: Parameters<typeof actual.updateJob>) => {
      const result = await actual.updateJob(...args);
      const status = args[1].status;
      if (status === "succeeded" || status === "failed") written.add(args[0]);
      return result;
    },
  };
});

class FakeWorker {
  static last: FakeWorker | undefined;
  sent: ToWorker[] = [];
  onmessage: ((event: { data: FromWorker }) => void) | null = null;
  onerror: ((event: { message: string; preventDefault(): void }) => void) | null = null;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(message: ToWorker) {
    this.sent.push(message);
  }
  terminate() {}
  emit(data: FromWorker) {
    this.onmessage?.({ data });
  }
}

const job: BrowserRenderJob = { width: 720, height: 1280, fps: 24, script: { lines: [], actor: { id: "a", name: "A", gender: "female", ageRange: "25-34", voiceProfile: "warm" }, language: "en" } };

let locks: FakeLockManager;
// When its lock went: whether the job's outcome was already written, and the
// job as IndexedDB then held it.
let outcomeWrittenAtRelease: boolean | undefined;
let atRelease: Promise<JobRecord | undefined> | undefined;
let runner: typeof import("./runner");

beforeAll(async () => {
  vi.stubGlobal("Worker", FakeWorker);
  runner = await import("./runner");
});

beforeEach(async () => {
  locks = installFakeLocks();
  atRelease = undefined;
  outcomeWrittenAtRelease = undefined;
  written.clear();
  locks.onRelease = (name) => {
    const id = name.replace("troupe-render:", "");
    outcomeWrittenAtRelease = written.has(id);
    atRelease = readJob(id);
  };
  probe.fail = false;
  await clearJobs();
});

afterEach(() => vi.useRealTimers());

const settled = () => vi.waitFor(async () => expect(atRelease).toBeDefined());
const held = async () => (await locks.query()).held.map((l) => l.name);

describe("browser renderer (page side)", () => {
  it("records the job under its lock and hands it to the worker", async () => {
    const id = await runner.browserRenderer.start(job);
    expect(await readJob(id)).toMatchObject({ id, status: "queued", job });
    expect(await held()).toEqual([`troupe-render:${id}`]);
    expect(FakeWorker.last?.sent.at(-1)).toEqual({ type: "render", jobId: id, job });
  });

  it("writes the finished video, checked, before it lets go of the lock", async () => {
    const id = await runner.browserRenderer.start(job);
    FakeWorker.last!.emit({ type: "progress", jobId: id, stage: { stage: "frames", frame: 0, frames: 24 } });
    FakeWorker.last!.emit({ type: "done", jobId: id, video: new Blob(["mp4"]) });
    await settled();
    expect(outcomeWrittenAtRelease).toBe(true);
    expect(await atRelease).toMatchObject({ status: "succeeded", probe: { durationS: 5, width: 720, height: 1280 }, checksum: "sha-of-3" });
    expect(await held()).toEqual([]);
    expect(await runner.browserRenderer.state(id)).toEqual({ status: "succeeded" });
  });

  it("writes a failure before it lets go of the lock", async () => {
    const id = await runner.browserRenderer.start(job);
    FakeWorker.last!.emit({ type: "failed", jobId: id, message: "The voice model could not load." });
    await settled();
    expect(outcomeWrittenAtRelease).toBe(true);
    expect(await atRelease).toMatchObject({ status: "failed", detail: "The voice model could not load." });
    expect(await runner.browserRenderer.state(id)).toEqual({ status: "failed", detail: "The voice model could not load." });
  });

  it("fails a video the browser cannot read back, rather than handing it on", async () => {
    probe.fail = true;
    const id = await runner.browserRenderer.start(job);
    FakeWorker.last!.emit({ type: "done", jobId: id, video: new Blob(["broken"]) });
    await settled();
    expect(await atRelease).toMatchObject({ status: "failed", detail: "This browser cannot play the video it rendered." });
    expect((await readJob(id))?.video).toBeUndefined();
  });

  it("fails every render the worker held when it dies", async () => {
    const first = await runner.browserRenderer.start(job);
    const second = await runner.browserRenderer.start(job);
    FakeWorker.last!.onerror?.({ message: "out of memory", preventDefault() {} });
    await vi.waitFor(async () => expect(await held()).toEqual([]));
    for (const id of [first, second]) expect(await readJob(id)).toMatchObject({ status: "failed", detail: "The render stopped: out of memory. Relaunch it." });
  });
});
