import type { LocalData } from "~/app/_components/edition";
import { resetDatabase, restoreDatabase, snapshotDatabase } from "../db/client";
import { clearMediaFiles, keepOnlyMediaFiles, readMediaFiles, saveMediaFiles } from "../media";
import { clearJobs } from "../render/jobs";
import { packBackup, summarize, unpackBackup, type Backup } from "./backup";
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

// The files go in first, in one transaction: when the device has no room for
// them nothing has changed yet. Then the database, also all or nothing; if
// it fails, the files it brought are taken out again.
async function restore(backup: Backup): Promise<void> {
  const before = new Set((await readMediaFiles()).map((file) => file.id));
  await saveMediaFiles(backup.media);
  const incoming = new Set(backup.media.map((file) => file.id));
  try {
    await restoreDatabase(backup.database);
  } catch (error) {
    await keepOnlyMediaFiles(before).catch(() => {});
    throw error;
  }
  await keepOnlyMediaFiles(incoming);
  // Jobs belonged to the replaced studio; a render it had running shows as
  // no longer in this browser, with Relaunch.
  await clearJobs();
  reopen();
}

export const localData: LocalData = {
  deleteAll,
  exportBackup,
  async readBackup(file) {
    const backup = await unpackBackup(file);
    return { summary: summarize(backup), restore: () => restore(backup) };
  },
  storage,
};
