import type * as Real from "~/server/shot-media";
import type { Db } from "~/server/db/types";
import { imageSize, sniffMedia } from "~/server/media-sniff";
import {
  MEDIA_TIMEOUT_MS,
  mediaProviders,
  renderMediaShotWith,
  type KeepShotFile,
  type MediaRenderer,
  type MediaShotInput,
} from "~/server/shot-media-core";
import { saveMediaFile } from "../media";

// Stands in for src/server/shot-media.ts in the browser edition: photos and
// voice clips render on the visitor's own key, straight from this page to
// the provider, and are kept in this browser with the renders (IndexedDB),
// where the media service worker serves them.

export { MEDIA_TIMEOUT_MS, imageSize, sniffMedia };
export type { MediaRenderer, MediaShotInput };

async function audioDurationS(blob: Blob): Promise<number | null> {
  try {
    const context = new OfflineAudioContext(1, 1, 44_100);
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    return audio.duration > 0 ? audio.duration : null;
  } catch {
    return null;
  }
}

const keepInBrowser: KeepShotFile = async ({ assetId, storagePath, bytes, mime, medium }) => {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime });
  await saveMediaFile({ id: assetId, storagePath, blob });
  return { storage: "indexeddb", durationS: medium === "speech" ? await audioDurationS(blob) : null };
};

export function renderMediaShot(db: Db, input: MediaShotInput, renderers: MediaRenderer = mediaProviders) {
  return renderMediaShotWith(db, input, keepInBrowser, renderers);
}

// Fails the typecheck when the real module's exports change shape.
({ MEDIA_TIMEOUT_MS, sniffMedia, imageSize, renderMediaShot }) satisfies typeof Real;
