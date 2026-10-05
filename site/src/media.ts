import type { MediaStore, StoredFile } from "~/server/media/store";
import { actorPictureUrl } from "~/modules/actors/pictures";

// Renders made in the demo live in IndexedDB, one record per media asset:
// { id: asset id, storagePath, blob }. The service worker (public/sw.js)
// serves them at /troupe/app/media/<id>, with byte ranges for seeking.
// Keep DB_NAME and STORE in step with public/sw.js.

const DB_NAME = "troupe-media";
const STORE = "files";

export interface MediaFile {
  id: string;
  storagePath: string;
  blob: Blob;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" }).createIndex("storagePath", "storagePath");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function write(run: (store: IDBObjectStore) => void): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function saveMediaFile(file: MediaFile): Promise<void> {
  return write((store) => store.put(file));
}

export function clearMediaFiles(): Promise<void> {
  return write((store) => store.clear());
}

function removeByStoragePath(files: StoredFile[]): Promise<void> {
  return write((store) => {
    const index = store.index("storagePath");
    for (const { storagePath } of files) {
      index.openKeyCursor(IDBKeyRange.only(storagePath)).onsuccess = function () {
        const cursor = this.result;
        if (!cursor) return;
        store.delete(cursor.primaryKey);
        cursor.continue();
      };
    }
  });
}

export const demoMedia: MediaStore = {
  urlFor: (assetId, opts) => `${import.meta.env.BASE_URL}app/media/${encodeURIComponent(assetId)}${opts?.download ? "?download=1" : ""}`,
  // The build copies the cast to <base>actors/ (site/vite-plugins.ts).
  pictureUrl: (storagePath) => actorPictureUrl(`${import.meta.env.BASE_URL}actors`, storagePath),
  remove: (files) => removeByStoragePath(files),
};

// The worker only controls pages under /troupe/app/. Without it (a browser
// that refuses service workers) the studio still works; renders do not play.
export function registerMediaWorker() {
  if (!("serviceWorker" in navigator)) return;
  const base = import.meta.env.BASE_URL;
  navigator.serviceWorker.register(`${base}sw.js`, { scope: `${base}app/` }).catch((error: unknown) => {
    console.warn("The media service worker could not start:", error);
  });
}
