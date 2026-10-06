// Reads a finished render back the way the player will, from a <video>
// (there is no ffprobe here), and fingerprints it. The page does this when a
// render ends, so the studio's database transaction never waits on it.

const PROBE_TIMEOUT_MS = 15_000;

export interface VideoProbe {
  durationS: number;
  width: number;
  height: number;
}

function probeVideo(blob: Blob): Promise<VideoProbe> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  return new Promise<VideoProbe>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The rendered video could not be read in time.")),
      PROBE_TIMEOUT_MS,
    );
    video.onloadedmetadata = () => {
      clearTimeout(timer);
      const probe = { durationS: video.duration, width: video.videoWidth, height: video.videoHeight };
      if (!Number.isFinite(probe.durationS) || probe.durationS <= 0 || probe.width <= 0 || probe.height <= 0)
        reject(new Error("The rendered video has no playable picture."));
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

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function readVideo(blob: Blob): Promise<{ probe: VideoProbe; checksum: string }> {
  const [probe, checksum] = await Promise.all([probeVideo(blob), sha256(blob)]);
  return { probe, checksum };
}
