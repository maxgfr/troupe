import type { LocalData } from "~/app/_components/edition";
import { referencedMediaIds, resetDatabase, restoreDatabase, snapshotDatabase } from "../db/client";
import { MIGRATIONS } from "../db/migrations";
import { clearMediaFiles, deleteMediaFiles, mediaFileIds, readMediaFiles, saveMediaFiles } from "../media";
import { clearJobs } from "../render/jobs";
import { checkMigrations, packBackup, summarize, unpackBackup, type Backup } from "./backup";
import { storage } from "./storage";

// All of the browser edition's data, which lives in this browser alone:
// the database (site/src/db), the renders (site/src/media.ts) and the render
// jobs (site/src/render/jobs.ts). Deleting or importing reloads every open
// tab of the studio onto the result.

const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("troupe-local-data");

channel?.addEventListener("message", (event) => {
  if (event.data === "replaced") window.location.reload();
});

function reopen() {
  channel?.postMessage("replaced");
  window.location.assign(`${import.meta.env.BASE_URL}app/dashboard`);
}

// An import and the clean-up of unreferenced files never overlap, in any tab:
// the import stores files before the database refers to them.
const DATA_LOCK = "troupe-local-data";

function withDataLock<T>(run: () => Promise<T>): Promise<T> {
  // The lock API resolves with what the callback resolves with.
  return navigator.locks ? (navigator.locks.request(DATA_LOCK, run) as unknown as Promise<T>) : run();
}

async function deleteAll(): Promise<void> {
  await resetDatabase();
  await clearMediaFiles();
  await clearJobs();
  reopen();
}

async function exportBackup() {
  const database = await snapshotDatabase();
  return packBackup({ database, media: await readMediaFiles() });
}

// Until the database commits, nothing that was here changes: the backup's
// new files go in first, all or none (a device without room fails here), and
// come out again if the database refuses the backup. A file it shares with
// this browser (the same asset id) is only replaced once the database has
// committed. Then the clean-up; whatever happens to it, every tab reloads onto
// the restored studio, and pruneUnreferencedMedia finishes the job.
export async function restoreBackup(backup: Backup): Promise<void> {
  await withDataLock(async () => {
    const before = new Set(await mediaFileIds());
    const added = backup.media.filter((file) => !before.has(file.id));
    await saveMediaFiles(added);
    try {
      await restoreDatabase(backup.database);
    } catch (error) {
      await deleteMediaFiles(added.map((file) => file.id)).catch((cleanup: unknown) => console.warn("The backup's files could not be taken out again:", cleanup));
      throw error;
    }
    try {
      const incoming = new Set(backup.media.map((file) => file.id));
      await saveMediaFiles(backup.media.filter((file) => before.has(file.id)));
      await deleteMediaFiles([...before].filter((id) => !incoming.has(id)));
      // Jobs belonged to the replaced studio; a render it had running shows as
      // no longer in this browser, with Relaunch.
      await clearJobs();
    } catch (error) {
      console.warn("The backup was imported; old files are cleared on the next start:", error);
    }
  });
  reopen();
}

// Files no media asset refers to: left by an import cut short (a closed tab)
// or a deletion that did not finish. The ids are read before the database,
// and a render's file is only stored after its asset is recorded, so a file
// stored meanwhile is never taken for a leftover.
export async function pruneUnreferencedMedia(): Promise<void> {
  try {
    await withDataLock(async () => {
      const stored = await mediaFileIds();
      if (stored.length === 0) return;
      const referenced = await referencedMediaIds();
      await deleteMediaFiles(stored.filter((id) => !referenced.has(id)));
    });
  } catch (error) {
    console.warn("Unused video files could not be cleared:", error);
  }
}

const KNOWN_MIGRATIONS = MIGRATIONS.map((migration) => migration.name);

export const localData: LocalData = {
  deleteAll,
  exportBackup,
  async readBackup(file) {
    const backup = await unpackBackup(file);
    checkMigrations(backup, KNOWN_MIGRATIONS);
    return { summary: summarize(backup), restore: () => restoreBackup(backup) };
  },
  storage,
};
