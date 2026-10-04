import { ingestRender, type RenderIngestor } from "~/modules/generation";
import { saveMediaFile } from "../media";
import { forgetRender } from "./runner";

// The demo's counterpart of persistProviderRender (src/server/media/storage.ts):
// the browser itself checks that the file is a playable video (there is no
// ffprobe here), then the render is recorded and its file kept in IndexedDB,
// where the media service worker serves it.

const PROBE_TIMEOUT_MS = 15_000;

export interface VideoProbe {
  durationS: number;
  width: number;
  height: number;
}

// Reads the duration and size the way the player will: from a <video>.
export function probeVideo(blob: Blob): Promise<VideoProbe> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  return new Promise<VideoProbe>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The rendered video could not be read in time.")), PROBE_TIMEOUT_MS);
    video.onloadedmetadata = () => {
      clearTimeout(timer);
      const probe = { durationS: video.duration, width: video.videoWidth, height: video.videoHeight };
      if (!Number.isFinite(probe.durationS) || probe.durationS <= 0 || probe.width <= 0 || probe.height <= 0) reject(new Error("The rendered video has no playable picture."));
      else resolve(probe);
    };
    video.onerror = () => {
      clearTimeout(timer);
      reject(new Error("This browser cannot play the video it rendered."));
    };
    video.src = url;
  }).finally(() => {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  });
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const ingestBrowserRender: RenderIngestor = async (db, gen, status, adapter) => {
  if (gen.outputAssetId) return;
  if (!status.outputUrl || !adapter.downloadResult) throw new Error("The render left no video.");
  const bytes = await adapter.downloadResult(status.outputUrl);
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "video/mp4" });
  const probe = await probeVideo(blob);
  const render = await ingestRender(db, {
    generationId: gen.id,
    bytes: bytes.length,
    checksum: await sha256(bytes),
    probe: async () => ({ ...probe, storage: "indexeddb" }),
  });
  await saveMediaFile({ id: render.id, storagePath: render.storagePath, blob });
  await forgetRender(status.providerJobId);
};
