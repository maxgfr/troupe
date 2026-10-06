import { useSyncExternalStore } from "react";

import type { LibraryUploader } from "~/app/_components/edition";
import { sha256Hex } from "~/modules/library/hash";
import { createCaller } from "~/server/api/root";
import { EXTENSIONS, SNIFF_BYTES, sniffType } from "~/server/library/sniff";
import { storeWhileRecording } from "../data/local-data";
import { createBrowserContext } from "../trpc";
import { libraryDownload, subscribeToLibraryDownload } from "./client";
import { pendingUploads } from "./backend";
import { LIBRARY_CONFIG } from "./env";

// The browser edition's uploads: the file is checked by its first bytes,
// kept in this browser (IndexedDB, served by the media worker), then
// recorded through the studio's own router, which starts its analysis. From
// storing to recording it holds the data lock, so another tab's clean-up of
// unreferenced files cannot take it meanwhile.

const stem = (name: string) => name.replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/[_-]+/g, " ").trim() || name;

async function upload(file: File, input: { workspaceId: string; mine: boolean; onProgress?: (fraction: number) => void }): Promise<{ id: string }> {
  if (file.size > LIBRARY_CONFIG.maxUploadMb * 1024 * 1024) throw new Error(`The file is larger than ${LIBRARY_CONFIG.maxUploadMb} MB, the most this browser keeps.`);
  const mimeType = sniffType(new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer()));
  if (!mimeType) throw new Error("This file is not one the library reads: use a video, a sound file, a picture (PNG, JPEG, WebP, GIF), a PDF or plain text.");
  const caller = createCaller(await createBrowserContext());
  if (mimeType === "text/plain") {
    const item = await caller.library.addText({ workspaceId: input.workspaceId, text: await file.text(), title: stem(file.name), mine: input.mine });
    input.onProgress?.(1);
    return { id: item.id };
  }
  const itemId = crypto.randomUUID();
  const assetId = crypto.randomUUID();
  const storagePath = `library/${itemId}/original.${EXTENSIONS[mimeType]}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const checksum = await sha256Hex(bytes);
  input.onProgress?.(0.5);
  pendingUploads.set(itemId, { assetId, storagePath, mimeType, bytes: bytes.length, checksum, fileName: file.name.slice(0, 200) });
  try {
    const item = await storeWhileRecording({ id: assetId, storagePath, blob: new Blob([bytes], { type: mimeType }) }, () => caller.library.addUpload({ workspaceId: input.workspaceId, uploadId: itemId, mine: input.mine }));
    input.onProgress?.(1);
    return { id: item.id };
  } catch (error) {
    pendingUploads.delete(itemId);
    throw error;
  }
}

// Under the add bar: what the first analysis downloads, then its progress.
function LibraryNote() {
  const download = useSyncExternalStore(subscribeToLibraryDownload, libraryDownload);
  // The worker sends a size only once it knows one; a failed download clears it.
  if (download && download.totalBytes > 0) {
    const percent = Math.round((download.loadedBytes / download.totalBytes) * 100);
    return (
      <div className="max-w-md space-y-1.5" role="status">
        <p className="flex items-baseline justify-between gap-3 text-xs">
          <span>Downloading the {download.model === "whisper" ? "transcription" : "search"} model</span>
          <span className="font-mono tabular-nums text-muted">{Math.round(download.loadedBytes / 1024 / 1024)} / {Math.round(download.totalBytes / 1024 / 1024)} MB</span>
        </p>
        <div className="progress-glow h-1.5 overflow-hidden rounded-full bg-primary/20">
          <div className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out motion-reduce:transition-none" style={{ width: `${Math.max(2, percent)}%` }} />
        </div>
      </div>
    );
  }
  return (
    <p className="max-w-[72ch] text-pretty text-xs text-muted">
      Everything stays in this browser. Transcription and search run in this tab; the first analysis downloads their models
      {LIBRARY_CONFIG.downloadMb ? <span className="font-mono tabular-nums"> (about {LIBRARY_CONFIG.downloadMb} MB)</span> : null} and keeps them.
    </p>
  );
}

export const browserLibrary: LibraryUploader = { upload, Note: LibraryNote };
