import { ALL_FORMATS, BlobSource, Input } from "mediabunny";

// What a saved file holds, read from its container without decoding it:
// its length, whether it has a picture, and its sound track's codec if it
// has one. Null when the container is one mediabunny does not read; the page
// then asks a media element instead.

export interface Tracks {
  durationS: number | null;
  hasVideo: boolean;
  // The sound track's codec ("aac", "opus"…), or null without one.
  audioCodec: string | null;
}

export async function readTracks(blob: Blob): Promise<Tracks | null> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const [video, audio] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
    const duration = await input.computeDuration().catch(() => Number.NaN);
    return {
      durationS: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 100) / 100 : null,
      hasVideo: video !== null,
      audioCodec: audio ? (audio.codec ?? "an unknown codec") : null,
    };
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}

// The browser edition reads files up to VITE_LIBRARY_MAX_MINUTES long: past
// that, decoding the sound and running Whisper in a tab takes too long and
// too much memory. The self-hosted studio reads longer ones.
export function tooLongForBrowser(durationS: number | null, maxMinutes: number): string | null {
  if (durationS === null || durationS <= maxMinutes * 60) return null;
  const minutes = Math.ceil(durationS / 60);
  return `This file is ${minutes} minutes long, too long for this browser: it reads up to ${maxMinutes} minutes (VITE_LIBRARY_MAX_MINUTES). Cut it into shorter parts, or use the self-hosted studio.`;
}
