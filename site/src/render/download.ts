import type { ProgressInfo } from "@huggingface/transformers";

import type { VoiceDevice } from "./protocol";
import type { DownloadProgress } from "./tts";

// The voice model's download, as one figure: every file of a load added up.
// A load given up for another (WebGPU falling back to the CPU) is stopped,
// so files it still reports never count towards the new one.
export function trackDownload(device: VoiceDevice, onDownload: (progress: DownloadProgress) => void): { onEvent: (event: ProgressInfo) => void; stop: () => void } {
  // One entry per file; the sizes are known once each download starts.
  const files = new Map<string, { loaded: number; total: number }>();
  let stopped = false;
  return {
    onEvent(event) {
      if (stopped || (event.status !== "progress" && event.status !== "done")) return;
      const previous = files.get(event.file);
      if (event.status === "progress") files.set(event.file, { loaded: event.loaded, total: event.total });
      else if (previous) files.set(event.file, { loaded: previous.total, total: previous.total });
      let loadedBytes = 0;
      let totalBytes = 0;
      for (const file of files.values()) {
        loadedBytes += file.loaded;
        totalBytes += file.total;
      }
      onDownload({ loadedBytes, totalBytes, device });
    },
    stop() {
      stopped = true;
      files.clear();
    },
  };
}
