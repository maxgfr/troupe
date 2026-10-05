import type { PGlite } from "@electric-sql/pglite";
import { PGliteWorker } from "@electric-sql/pglite/worker";
import { drizzle } from "drizzle-orm/pglite";

import { mediaAssets } from "~/modules/generation";
import { ensureLocalStudio } from "~/modules/identity";
import { migratePglite, rebuildPglite, restorePglite, snapshotPglite, type PgliteSnapshot } from "~/server/db/pglite-migrate";
import * as schema from "~/server/db/schema";
import type { Db } from "~/server/db/types";
import { ensureBrowserModel } from "../catalog";
import { MIGRATIONS } from "./migrations";
import { INIT_FAILED } from "./protocol";

// The browser edition's database: Postgres (PGlite) in a worker, kept in
// IndexedDB so projects survive reloads and deploys. Migrations already
// applied are recorded in troupe_static_migrations, so a new deploy only runs
// new ones.

const DATA_DIR = "idb://troupe";
// PGlite keeps an idb:// database in the IndexedDB database of this name.
const IDB_NAME = "/pglite/troupe";
// Tabs take turns migrating or resetting, so two tabs never both apply one.
const SETUP_LOCK = "troupe-db-setup";

export interface BrowserDatabase {
  pg: PGliteWorker;
  db: Db;
}

let opening: Promise<BrowserDatabase> | undefined;

// The worker's queries wait forever when Postgres cannot start: fail instead,
// so the studio can show what happened and offer a reset.
// PGlite also hangs, without a word, when its files fail to download: give
// up after a delay long enough for a first download on a slow connection.
const START_TIMEOUT_MS = 180_000;

function startFailure(host: Worker): { failed: Promise<never>; settle: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const failed = new Promise<never>((_, reject) => {
    host.addEventListener("message", (event: MessageEvent<{ type?: string; message?: string }>) => {
      if (event.data?.type === INIT_FAILED) reject(new Error(`The database could not start (${event.data.message}). Check your connection, then reload.`));
    });
    host.addEventListener("error", () => reject(new Error("The database could not start: its worker failed to load.")));
    timer = setTimeout(() => reject(new Error("The database did not start. Check your connection, then reload.")), START_TIMEOUT_MS);
  });
  failed.catch(() => {});
  return { failed, settle: () => clearTimeout(timer) };
}

async function connect(host: Worker): Promise<BrowserDatabase> {
  const pg = await PGliteWorker.create(host, { dataDir: DATA_DIR });
  await navigator.locks.request(SETUP_LOCK, () => migratePglite(pg, MIGRATIONS));
  // drizzle's PGlite driver only needs query/transaction, which the worker proxy has.
  const db = drizzle(pg as unknown as PGlite, { schema }) as unknown as Db;
  await ensureLocalStudio(db);
  await ensureBrowserModel(db);
  return { pg, db };
}

async function open(): Promise<BrowserDatabase> {
  const host = new Worker(new URL("./pglite.worker.ts", import.meta.url), { type: "module" });
  const start = startFailure(host);
  try {
    return await Promise.race([connect(host), start.failed]);
  } catch (error) {
    host.terminate();
    throw error;
  } finally {
    start.settle();
  }
}

function openOnce(): Promise<BrowserDatabase> {
  opening ??= open().catch((error: unknown) => {
    opening = undefined;
    throw error;
  });
  return opening;
}

// A reset or a restore in this tab. Between dropping the tables and seeding
// the studio again the database holds no workspace, so everyone else waits
// it out.
let resetting: Promise<void> | undefined;
let rebuilds = 0;

async function resetDone() {
  while (resetting) await resetting.catch(() => {});
}

// For calls already past the wait below when a rebuild starts
// (site/src/rebuild-link.ts): how many have started, and when none runs.
export const rebuildGeneration = () => rebuilds;
export const rebuildsDone = () => resetDone();

export async function browserDatabase(): Promise<BrowserDatabase> {
  // Before the open: a reset that is deleting a database that would not open
  // must not have a new worker reopen it underneath.
  await resetDone();
  const database = await openOnce();
  // And after it: a page that asked during a slow start must not slip in
  // between the rebuild and the seed.
  await resetDone();
  return database;
}

// Runs a change that empties the tables for a while; queries from this tab
// wait for all of it, the studio seeded again included.
function rebuildWith(change: () => Promise<void>): Promise<void> {
  rebuilds += 1;
  const run = change();
  const pending: Promise<void> = run.finally(() => {
    if (resetting === pending) resetting = undefined;
  });
  // The caller sees a failure through `run`; waiting pages only need the end.
  pending.catch(() => {});
  resetting = pending;
  return run;
}

async function seed(db: Db) {
  await ensureLocalStudio(db);
  await ensureBrowserModel(db);
}

// Empties the studio: every table is dropped and the migrations run again,
// in one transaction, then the studio is seeded. When the database cannot
// even open, its IndexedDB copy is deleted instead.
export function resetDatabase(): Promise<void> {
  return rebuildWith(async () => {
    let database: BrowserDatabase;
    try {
      database = await openOnce();
    } catch {
      await deleteIndexedDb(IDB_NAME);
      return;
    }
    const { pg, db } = database;
    await navigator.locks.request(SETUP_LOCK, () => rebuildPglite(pg, MIGRATIONS));
    await seed(db);
  });
}

// The media assets the studio has recorded: the files it needs.
export async function referencedMediaIds(): Promise<Set<string>> {
  const { db } = await browserDatabase();
  return new Set((await db.select({ id: mediaAssets.id }).from(mediaAssets)).map((row) => row.id));
}

// Every table's rows, for a backup.
export async function snapshotDatabase(): Promise<PgliteSnapshot> {
  return snapshotPglite((await browserDatabase()).pg);
}

// Replaces the whole database with a backup's, in one transaction: a backup
// that does not fit changes nothing (restorePglite).
export function restoreDatabase(snapshot: PgliteSnapshot): Promise<void> {
  return rebuildWith(async () => {
    const { pg, db } = await openOnce();
    await navigator.locks.request(SETUP_LOCK, () => restorePglite(pg, MIGRATIONS, snapshot));
    await seed(db);
  });
}

function deleteIndexedDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close the studio's other tabs, then try again."));
  });
}
