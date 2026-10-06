// Serves the browser edition's renders from IndexedDB at <scope>media/<asset
// id>, the URLs the in-browser media store hands out (site/src/media.ts),
// with byte ranges so a <video> can seek. Mirrors src/server/media/serve.ts.

const DB_NAME = "troupe-media";
const STORE = "files";
// The only types served as themselves: renders and the library's videos,
// sound and pictures (keep in step with MEDIA_TYPES in
// site/src/data/backup.ts; site/src/media-worker.test.ts checks). Anything
// else is a download: a file served inline from the studio's own origin as
// HTML or SVG would run as one of its pages.
// Renders, named with mediaDisposition's copy below.
const PLAYABLE = new Set(["video/mp4", "video/webm"]);
const INLINE = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mp4",
  "audio/mpeg",
  "audio/aac",
  "audio/wav",
  "audio/ogg",
  "audio/flac",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
// Kept, but always a download.
const DOWNLOAD_ONLY = new Set(["application/pdf"]);

// Service worker globals are not in the DOM typings the repo checks against.
/** @type {any} */
const worker = self;

worker.addEventListener("install", () => worker.skipWaiting());
worker.addEventListener("activate", (/** @type {any} */ event) => event.waitUntil(worker.clients.claim()));

worker.addEventListener("fetch", (/** @type {any} */ event) => {
  const url = new URL(event.request.url);
  const prefix = new URL("media/", worker.registration.scope).pathname;
  if (event.request.method !== "GET" || url.origin !== worker.location.origin || !url.pathname.startsWith(prefix))
    return;
  const id = decodeURIComponent(url.pathname.slice(prefix.length));
  event.respondWith(serve(id, event.request.headers.get("range"), url.searchParams.get("download")));
});

// Mirrors mediaDisposition in src/server/media/store.ts
// (site/src/media-worker.test.ts checks they agree).
/** @param {string | null} download @param {string} ext */
function disposition(download, ext) {
  if (download === null) return `inline; filename="troupe-video.${ext}"`;
  const stem = download.replace(/\.(mp4|webm)$/i, "");
  const safe = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(stem) && stem !== "1" ? stem : "troupe-video";
  return `attachment; filename="${safe}.${ext}"`;
}

/** @param {string} id @returns {Promise<{ id: string, storagePath: string, blob: Blob } | undefined>} */
function readFile(id) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () =>
      open.result.createObjectStore(STORE, { keyPath: "id" }).createIndex("storagePath", "storagePath");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const get = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
      get.onsuccess = () => {
        db.close();
        resolve(get.result);
      };
      get.onerror = () => {
        db.close();
        reject(get.error);
      };
    };
  });
}

/**
 * @param {string} id
 * @param {string | null} range
 * @param {string | null} download the URL's download query: null plays inline
 */
async function serve(id, range, download) {
  const file = await readFile(id).catch(() => undefined);
  if (!file) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  const blob = file.blob;
  const size = blob.size;
  const stored = blob.type || "video/mp4";
  const playable = PLAYABLE.has(stored);
  const inline = INLINE.has(stored);
  const type = inline || DOWNLOAD_ONLY.has(stored) ? stored : "application/octet-stream";
  const library = `troupe-library.${stored.split("/")[1]?.replace(/[^a-z0-9]/g, "") || "bin"}`;
  const headers = new Headers({
    "content-type": type,
    "accept-ranges": "bytes",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "content-disposition": playable
      ? disposition(download, type === "video/webm" ? "webm" : "mp4")
      : inline && download === null
        ? `inline; filename="${library}"`
        : `attachment; filename="${stored === "application/pdf" ? "troupe-library.pdf" : inline ? library : "troupe-file.bin"}"`,
  });
  let start = 0;
  let end = size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const unsatisfiable = () => new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    if (!match || (!match[1] && !match[2])) return unsatisfiable();
    if (match[1]) {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    } else {
      start = Math.max(0, size - Number(match[2]));
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size)
      return unsatisfiable();
    headers.set("content-range", `bytes ${start}-${end}/${size}`);
  }
  headers.set("content-length", String(end - start + 1));
  return new Response(blob.slice(start, end + 1, type), { status: range ? 206 : 200, headers });
}
