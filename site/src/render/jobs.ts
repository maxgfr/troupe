import type { BrowserJobState, BrowserRenderJob } from "~/modules/generation";

// Render jobs live in IndexedDB, so any tab can follow them and a reload
// finds them again. The tab rendering a job holds a Web Lock named after it
// for as long as the render runs: a job still marked queued or running
// whose lock nobody holds belonged to a tab that closed, and is failed.

const DB_NAME = "troupe-render";
const STORE = "jobs";

export interface JobRecord {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  job: BrowserRenderJob;
  detail?: string;
  // The finished MP4, until the studio has stored it as a render, with what
  // the page read from it (checked before the studio's transaction opens).
  video?: Blob;
  probe?: { durationS: number; width: number; height: number };
  checksum?: string;
  createdAt: number;
}

export const INTERRUPTED = "The tab rendering this video was closed before it finished. Relaunch it.";

const lockName = (jobId: string) => `troupe-render:${jobId}`;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T> | undefined): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = body(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const readJob = (id: string) => run<JobRecord | undefined>("readonly", (store) => store.get(id));
const readAll = async () => (await run<JobRecord[]>("readonly", (store) => store.getAll())) ?? [];
export const saveJob = (record: JobRecord) => run("readwrite", (store) => store.put(record)).then(() => {});

// The finished jobs the adapter last read (jobState), by id. The ingest runs
// right after that read, inside the studio's transaction, and takes the
// render's details from here rather than going back to IndexedDB.
const known = new Map<string, JobRecord>();
export const knownJob = (id: string): JobRecord | undefined => known.get(id);

export async function deleteJob(id: string): Promise<void> {
  await run("readwrite", (store) => store.delete(id));
  known.delete(id);
}

export async function clearJobs(): Promise<void> {
  await run("readwrite", (store) => store.clear());
  known.clear();
}

// Read and write in one transaction, so concurrent updates never undo each
// other. `from` limits the update to jobs in one of these states.
export async function updateJob(id: string, patch: Partial<Omit<JobRecord, "id">>, from?: JobRecord["status"][]): Promise<JobRecord | undefined> {
  return run<JobRecord | undefined>("readwrite", (store) => {
    const request = store.get(id);
    request.onsuccess = () => {
      const record = request.result as JobRecord | undefined;
      if (!record || (from && !from.includes(record.status))) return;
      Object.assign(record, patch);
      store.put(record);
    };
    return request;
  });
}

// Holds the job's lock until `release` is called (or the tab goes away).
export function holdJobLock(jobId: string): Promise<() => void> {
  return new Promise((granted, refused) => {
    navigator.locks
      .request(lockName(jobId), () => new Promise<void>((release) => granted(release)))
      .catch(refused);
  });
}

async function heldLocks(): Promise<Set<string>> {
  const { held = [] } = await navigator.locks.query();
  return new Set(held.map((lock) => lock.name ?? ""));
}

function stateOf(record: JobRecord): BrowserJobState {
  if (record.status === "succeeded") return { status: "succeeded" };
  if (record.status === "failed") return { status: "failed", detail: record.detail ?? "The render failed." };
  return { status: record.status };
}

// Fails the job unless it finished in the meantime: a tab writes the outcome
// before it lets go of the lock, so a finished job is never failed here.
const failIfUnfinished = (id: string) => updateJob(id, { status: "failed", detail: INTERRUPTED }, ["queued", "running"]);

const unfinished = (record: JobRecord) => record.status === "queued" || record.status === "running";

// The job as the adapter sees it: one left unfinished by a closed tab fails.
// The reconciler asks inside its transaction. That costs one small record
// read (a stored MP4 comes back as a Blob handle, its bytes are not read), a
// Web Locks query and, rarely, one small write: kept there on purpose, since
// answering from a snapshot taken before the transaction could miss a job
// another tab just started and fail it, or report an outcome late.
export async function jobState(id: string): Promise<BrowserJobState | null> {
  let record = await readJob(id);
  if (!record) return null;
  if (unfinished(record) && !(await heldLocks()).has(lockName(id))) record = await failIfUnfinished(id);
  if (record && !unfinished(record)) known.set(id, record);
  return record ? stateOf(record) : null;
}

// On load: every unfinished job no tab is rendering any more is failed.
export async function failInterruptedJobs(): Promise<void> {
  const candidates = (await readAll()).filter(unfinished);
  if (candidates.length === 0) return;
  const held = await heldLocks();
  for (const record of candidates) if (!held.has(lockName(record.id))) await failIfUnfinished(record.id);
}

// What the studio says about finished jobs, once its transaction committed:
// "settled" when it is done with the job (with the file to keep when it
// recorded a render), "pending" while it may still need it. Jobs it does not
// know are kept for an hour, in case it has not yet recorded them, then
// dropped.
export type JobSettlement = { state: "pending" } | { state: "settled"; file?: { assetId: string; storagePath: string } };
const UNKNOWN_KEPT_MS = 60 * 60_000;

// Keeps the file of every render the studio recorded (keepFile), then
// forgets the job and its MP4. Called after the studio's transaction, never
// inside it, so a rolled-back commit leaves neither a file nor a lost video.
export async function pruneJobs(
  settlement: (jobIds: string[]) => Promise<ReadonlyMap<string, JobSettlement>>,
  keepFile: (file: { assetId: string; storagePath: string }, video: Blob) => Promise<void>,
): Promise<void> {
  const all = await readAll();
  // Jobs another tab already forgot: drop this tab's copy (and its MP4 handle).
  const stored = new Set(all.map((record) => record.id));
  for (const id of known.keys()) if (!stored.has(id)) known.delete(id);
  const finished = all.filter((record) => !unfinished(record));
  if (finished.length === 0) return;
  const settled = await settlement(finished.map((record) => record.id));
  const now = Date.now();
  for (const record of finished) {
    const outcome = settled.get(record.id);
    if (outcome?.state === "settled") {
      if (outcome.file && record.video) await keepFile(outcome.file, record.video);
      await deleteJob(record.id);
    } else if (outcome === undefined && now - record.createdAt > UNKNOWN_KEPT_MS) {
      await deleteJob(record.id);
    }
  }
}
