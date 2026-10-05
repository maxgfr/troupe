// Where the API sends people for stored renders, and how it deletes them.
// Self-hosted, renders play from the /api/media route; another host passes
// its own store through the request context. Nothing here touches Node.

// A stored render file, as listed when its rows are deleted.
export interface StoredFile {
  storagePath: string;
  storage: "local" | "supabase";
}

export interface MediaLinks {
  // A URL the browser can play, or download when `download` is set.
  urlFor(assetId: string, opts?: { download?: boolean }): string;
}

export interface MediaStore extends MediaLinks {
  // Best effort, once the rows are gone: a file already missing is fine.
  remove(files: StoredFile[]): Promise<void>;
}

// Served by src/app/api/media/[assetId]/route.ts.
export const apiMediaLinks: MediaLinks = {
  urlFor: (assetId, opts) => `/api/media/${assetId}${opts?.download ? "?download=1" : ""}`,
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
