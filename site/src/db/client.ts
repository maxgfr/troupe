import type { PGlite } from "@electric-sql/pglite";
import { PGliteWorker } from "@electric-sql/pglite/worker";
import { drizzle } from "drizzle-orm/pglite";

import { ensureLocalStudio } from "~/modules/identity";
import { migratePglite, rebuildPglite } from "~/server/db/pglite-migrate";
import * as schema from "~/server/db/schema";
import type { Db } from "~/server/db/types";
import { MIGRATIONS } from "./migrations";
import { INIT_FAILED } from "./protocol";

// The demo's database: Postgres (PGlite) in a worker, kept in IndexedDB so
// projects survive reloads and deploys. Migrations already applied are
// recorded in troupe_static_migrations, so a new deploy only runs new ones.

const DATA_DIR = "idb://troupe";
// PGlite keeps an idb:// database in the IndexedDB database of this name.
const IDB_NAME = "/pglite/troupe";
// Tabs take turns migrating or resetting, so two tabs never both apply one.
const SETUP_LOCK = "troupe-db-setup";

export interface DemoDatabase {
  pg: PGliteWorker;
  db: Db;
}

let opening: Promise<DemoDatabase> | undefined;

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

async function connect(host: Worker): Promise<DemoDatabase> {
  const pg = await PGliteWorker.create(host, { dataDir: DATA_DIR });
  await navigator.locks.request(SETUP_LOCK, () => migratePglite(pg, MIGRATIONS));
  // drizzle's PGlite driver only needs query/transaction, which the worker proxy has.
  const db = drizzle(pg as unknown as PGlite, { schema }) as unknown as Db;
  await ensureLocalStudio(db);
  return { pg, db };
}

async function open(): Promise<DemoDatabase> {
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

function openOnce(): Promise<DemoDatabase> {
  opening ??= open().catch((error: unknown) => {
    opening = undefined;
    throw error;
  });
  return opening;
}

// A reset in this tab. Between dropping the tables and seeding the studio
// again the database holds no workspace, so everyone else waits it out.
let resetting: Promise<void> | undefined;

export async function demoDatabase(): Promise<DemoDatabase> {
  const database = await openOnce();
  // Checked after the open too: a page that asked during a slow start must
  // not slip in between the rebuild and the seed.
  while (resetting) await resetting.catch(() => {});
  return database;
}

// Empties the studio: every table is dropped and the migrations run again,
// in one transaction, then the studio is seeded; queries from this tab wait
// for all of it. When the database cannot even open, its IndexedDB copy is
// deleted instead.
export function resetDatabase(): Promise<void> {
  const run = (async () => {
    let database: DemoDatabase;
    try {
      database = await openOnce();
    } catch {
      await deleteIndexedDb(IDB_NAME);
      return;
    }
    const { pg, db } = database;
    await navigator.locks.request(SETUP_LOCK, () => rebuildPglite(pg, MIGRATIONS));
    await ensureLocalStudio(db);
  })();
  const pending: Promise<void> = run.finally(() => {
    if (resetting === pending) resetting = undefined;
  });
  // The caller sees a failure through `run`; waiting pages only need the end.
  pending.catch(() => {});
  resetting = pending;
  return run;
}

function deleteIndexedDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close the studio's other tabs, then try again."));
  });
}
