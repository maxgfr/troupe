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
