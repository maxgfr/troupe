import type { BrowserRenderer } from "~/modules/generation";
import { failInterruptedJobs, holdJobLock, jobState, readJob, saveJob, updateJob, type JobRecord } from "./jobs";
import { readVideo } from "./probe";
import { overallProgress, type FromWorker, type RenderStage } from "./protocol";
import { renderSupport } from "./support";

// The browser edition's renderer, on the page side: it records each job in
// IndexedDB, holds the job's lock while this tab renders it, and hands the
// work to one worker that keeps the voice model loaded between renders.
// Progress is shared with the studio's other tabs over a BroadcastChannel.

type Message = { jobId: string; stage: RenderStage } | { jobId: string; finished: "succeeded" | "failed" };

const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("troupe-render");
const stages = new Map<string, RenderStage>();
const listeners = new Set<() => void>();
const finishListeners = new Set<(jobId: string) => void>();

function receive(message: Message) {
  if ("finished" in message) {
    // A finished video stays "saving" until the studio has stored it.
    if (message.finished === "succeeded") stages.set(message.jobId, { stage: "saving" });
    else stages.delete(message.jobId);
    for (const listener of finishListeners) listener(message.jobId);
  } else {
    stages.set(message.jobId, message.stage);
  }
  for (const listener of listeners) listener();
}

function publish(message: Message) {
  receive(message);
  channel?.postMessage(message);
}

channel?.addEventListener("message", (event: MessageEvent<Message>) => receive(event.data));

// For useSyncExternalStore: where each render in progress is, in any tab.
export function subscribeToRenders(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const renderStage = (jobId: string): RenderStage | undefined => stages.get(jobId);
export const renderProgress = (jobId: string): number | undefined => {
  const stage = stages.get(jobId);
  return stage ? overallProgress(stage) : undefined;
};

// Called when a render ends here or in another tab, to fetch its outcome.
export function onRenderFinished(listener: (jobId: string) => void): () => void {
  finishListeners.add(listener);
  return () => finishListeners.delete(listener);
}

// Jobs this tab renders, with the release of their lock.
const running = new Map<string, () => void>();
// The voice model takes memory (GPU memory with WebGPU): let it go when idle.
const IDLE_MS = 10 * 60_000;
let worker: Worker | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

type Outcome = { status: "succeeded"; video: Blob; probe: JobRecord["probe"]; checksum: string } | { status: "failed"; detail: string };

async function finish(jobId: string, outcome: Outcome) {
  try {
    // The outcome is written before the lock goes: a job whose lock is free
    // and still unfinished can only be one whose tab closed (jobs.ts).
    await updateJob(jobId, outcome);
  } finally {
    running.get(jobId)?.();
    running.delete(jobId);
    publish({ jobId, finished: outcome.status });
    if (running.size === 0) idleTimer = setTimeout(() => stopWorker(), IDLE_MS);
  }
}

function stopWorker() {
  worker?.terminate();
  worker = undefined;
}

function renderWorker(): Worker {
  clearTimeout(idleTimer);
  if (worker) return worker;
  const created = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  created.onmessage = ({ data }: MessageEvent<FromWorker>) => {
    if (data.type === "progress") {
      if (renderStage(data.jobId)?.stage === "queued") void updateJob(data.jobId, { status: "running" }, ["queued"]);
      publish({ jobId: data.jobId, stage: data.stage });
    } else if (data.type === "done") {
      // Checked here, so a file the browser cannot play fails the render, and
      // the studio's ingest only reads what was found.
      void readVideo(data.video).then(
        ({ probe, checksum }) => finish(data.jobId, { status: "succeeded", video: data.video, probe, checksum }),
        (error: unknown) => finish(data.jobId, { status: "failed", detail: error instanceof Error ? error.message : "The rendered video could not be read." }),
      );
    } else {
      void finish(data.jobId, { status: "failed", detail: data.message });
    }
  };
  // The worker died (out of memory, a crash): every render it held fails.
  created.onerror = (event) => {
    event.preventDefault();
    if (worker === created) worker = undefined;
    created.terminate();
    const detail = `The render stopped: ${event.message || "the browser ended its worker"}. Relaunch it.`;
    for (const jobId of [...running.keys()]) void finish(jobId, { status: "failed", detail });
  };
  worker = created;
  return created;
}

export const browserRenderer: BrowserRenderer = {
  async start(job) {
    const support = await renderSupport();
    if (!support.ok) throw new Error(support.detail);
    const jobId = crypto.randomUUID();
    // The lock comes first: a recorded job is never seen without its tab.
    const release = await holdJobLock(jobId);
    try {
      await saveJob({ id: jobId, status: "queued", job, createdAt: Date.now() });
    } catch (error) {
      release();
      throw error;
    }
    running.set(jobId, release);
    publish({ jobId, stage: { stage: "queued" } });
    renderWorker().postMessage({ type: "render", jobId, job });
    return jobId;
  },
  state: jobState,
  async result(jobId) {
    const record = await readJob(jobId);
    if (!record?.video) throw new Error("The finished video is no longer in this browser.");
    return new Uint8Array(await record.video.arrayBuffer());
  },
  async check() {
    const support = await renderSupport();
    return { ok: support.ok, message: support.detail };
  },
};


// Renders left unfinished by a tab that closed fail on the next load.
export function failInterruptedRenders(): void {
  failInterruptedJobs().catch((error: unknown) => console.warn("Interrupted renders could not be checked:", error));
}
