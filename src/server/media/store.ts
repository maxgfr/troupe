// Where the API sends people for stored renders and actors' pictures, and how
// it deletes renders. Self-hosted, renders play from the /api/media route and
// pictures load from public/actors (or TROUPE_ACTOR_PORTRAITS_URL); another
// host passes its own store through the request context.
import { actorPictureUrl, DEFAULT_PICTURES_BASE } from "~/modules/actors/pictures";

// A stored render file, as listed when its rows are deleted.
export interface StoredFile {
  storagePath: string;
  storage: "local" | "supabase";
}

export interface MediaLinks {
  // A URL the browser can play, or download when `download` is set.
  urlFor(assetId: string, opts?: { download?: boolean }): string;
  // Where the browser loads an actor's picture, from its storage path
  // (actors/<slug>/v<n>/<file>).
  pictureUrl(storagePath: string): string;
}

export interface MediaStore extends MediaLinks {
  // Best effort, once the rows are gone: a file already missing is fine.
  remove(files: StoredFile[]): Promise<void>;
}

// Served by src/app/api/media/[assetId]/route.ts.
// Pictures: Next serves public/actors at /actors; TROUPE_ACTOR_PORTRAITS_URL
// points at another copy of the cast (a CDN, a bucket, another path).
export const apiMediaLinks: MediaLinks = {
  urlFor: (assetId, opts) => `/api/media/${assetId}${opts?.download ? "?download=1" : ""}`,
  pictureUrl: (storagePath) => actorPictureUrl(process.env.TROUPE_ACTOR_PORTRAITS_URL || DEFAULT_PICTURES_BASE, storagePath),
};

export const DEFAULT_DOWNLOAD_NAME = "troupe-video";

// The name a media URL's `download` query saves the file under: null (no
// query) plays it inline; "1" or anything that is not a plain file name
// saves it as troupe-video.<ext>. Mirrored in site/public/sw.js.
export function downloadFileName(download: string | null, ext: "mp4" | "webm" = "mp4"): string | null {
  if (download === null) return null;
  const stem = download.replace(/\.(mp4|webm)$/i, "");
  const safe = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(stem) && stem !== "1" ? stem : DEFAULT_DOWNLOAD_NAME;
  return `${safe}.${ext}`;
}

// The Content-Disposition for a media URL's `download` query.
export function mediaDisposition(download: string | null, ext: "mp4" | "webm" = "mp4"): string {
  const name = downloadFileName(download, ext);
  return name === null ? `inline; filename="${DEFAULT_DOWNLOAD_NAME}.${ext}"` : `attachment; filename="${name}"`;
}
