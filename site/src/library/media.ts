import { sha256Hex } from "~/modules/library/hash";
import { cutsFromDifferences, frameTimes, type MediaReader, type StoredItemFile } from "~/modules/library";
import { mediaAssets } from "~/modules/generation";
import type { Db } from "~/server/db/types";
import { readMediaFile, saveMediaFile } from "../media";
import { LIBRARY_CONFIG } from "./env";
import { seekTo } from "./seek";
import { readTracks, tooLongForBrowser } from "./tracks";

// The library's media work in the page: the container says what tracks a
// file has (mediabunny, without decoding), a video element and a canvas take
// the pictures (cuts found by comparing small frames every half second), Web
// Audio decodes the sound straight to 16 kHz mono for Whisper. Workers have
// no video element, so this runs in the tab that analyses.

const SAMPLE_RATE = 16000;
// A seek or a file that does not answer within this long is given up on.
const SEEK_TIMEOUT_MS = 15_000;
const OPEN_TIMEOUT_MS = 30_000;
const COMPARE_W = 32;
const COMPARE_H = 18;
const FRAME_W = 360;
// At most this many comparisons, spread over a long video.
const MAX_SAMPLES = 240;

async function blobOf(file: StoredItemFile): Promise<Blob> {
  const stored = await readMediaFile(file.assetId);
  if (!stored) throw new Error("The saved file is no longer in this browser.");
  return stored.blob;
}

function media(url: string, kind: "video" | "audio"): Promise<HTMLVideoElement | HTMLAudioElement> {
  return new Promise((resolve, reject) => {
    const element = document.createElement(kind);
    const timer = setTimeout(() => reject(new Error("This browser could not open the file.")), OPEN_TIMEOUT_MS);
    element.muted = true;
    element.preload = "auto";
    element.onloadedmetadata = () => {
      clearTimeout(timer);
      resolve(element);
    };
    element.onerror = () => {
      clearTimeout(timer);
      reject(new Error("This browser cannot play the file."));
    };
    element.src = url;
  });
}

// Lets the element go of the file's memory.
function release(element: HTMLMediaElement) {
  element.removeAttribute("src");
  element.load();
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The picture could not be saved."))),
      "image/jpeg",
      0.82,
    ),
  );
}

// The sound track's codec by item, from the probe, for the reason when the
// browser cannot decode it.
const codecs = new Map<string, string | null>();

// The sound as 16 kHz mono: an OfflineAudioContext decodes at its own rate,
// so the file's sound is never held at its native rate (three times the
// memory at 48 kHz, twice again in stereo) before being resampled.
async function decode16k(blob: Blob): Promise<Float32Array> {
  const context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const buffer = await context.decodeAudioData(await blob.arrayBuffer());
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) mono[i]! += data[i]! / buffer.numberOfChannels;
  }
  return mono;
}

export function browserMediaReader(db: Db): MediaReader {
  return {
    // What the file holds, without decoding it; refused past the length
    // this browser analyses, before anything heavy runs.
    async probe(file) {
      const blob = await blobOf(file);
      let tracks = await readTracks(blob);
      if (!tracks) {
        // A container mediabunny does not read: the media element says what it can.
        const url = URL.createObjectURL(blob);
        try {
          const element = await media(url, file.mimeType.startsWith("audio/") ? "audio" : "video");
          tracks = {
            durationS: Number.isFinite(element.duration) ? Math.round(element.duration * 100) / 100 : null,
            hasVideo: element instanceof HTMLVideoElement && element.videoWidth > 0,
            // Unknown: the decoder will tell.
            audioCodec: "an unknown codec",
          };
          release(element);
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      const tooLong = tooLongForBrowser(tracks.durationS, LIBRARY_CONFIG.maxMinutes);
      if (tooLong) throw new Error(tooLong);
      codecs.set(file.itemId, tracks.audioCodec);
      return { durationS: tracks.durationS, hasVideo: tracks.hasVideo, hasAudio: tracks.audioCodec !== null };
    },

    async frames(file, options) {
      const url = URL.createObjectURL(await blobOf(file));
      try {
        const video = (await media(url, "video")) as HTMLVideoElement;
        const durationS = options.durationS ?? video.duration;
        const compare = Object.assign(document.createElement("canvas"), { width: COMPARE_W, height: COMPARE_H });
        const small = compare.getContext("2d", { willReadFrequently: true })!;
        const step = Math.max(0.5, durationS / MAX_SAMPLES);
        const differences: number[] = [];
        let previous: Uint8ClampedArray | null = null;
        for (let t = 0; t < durationS; t += step) {
          await seekTo(video, t, { timeoutMs: SEEK_TIMEOUT_MS, signal: options.signal });
          small.drawImage(video, 0, 0, COMPARE_W, COMPARE_H);
          const pixels = small.getImageData(0, 0, COMPARE_W, COMPARE_H).data;
          if (previous) {
            let sum = 0;
            for (let i = 0; i < pixels.length; i += 4)
              sum +=
                Math.abs(pixels[i]! - previous[i]!) +
                Math.abs(pixels[i + 1]! - previous[i + 1]!) +
                Math.abs(pixels[i + 2]! - previous[i + 2]!);
            differences.push(sum / ((pixels.length / 4) * 3 * 255));
          }
          previous = pixels;
        }
        const cutsAtS = cutsFromDifferences(differences, step);
        const scale = Math.min(1, FRAME_W / video.videoWidth);
        const canvas = Object.assign(document.createElement("canvas"), {
          width: Math.round(video.videoWidth * scale),
          height: Math.round(video.videoHeight * scale),
        });
        const context = canvas.getContext("2d")!;
        const frames: { assetId: string; atS: number }[] = [];
        for (const [n, atS] of frameTimes(cutsAtS, durationS, options.max).entries()) {
          if (atS >= durationS) continue;
          await seekTo(video, atS, { timeoutMs: SEEK_TIMEOUT_MS, signal: options.signal });
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const blob = await canvasBlob(canvas);
          const assetId = crypto.randomUUID();
          const storagePath = `library/${file.itemId}/frame-${String(n).padStart(2, "0")}.jpg`;
          const bytes = new Uint8Array(await blob.arrayBuffer());
          await db.insert(mediaAssets).values({
            id: assetId,
            workspaceId: file.workspaceId,
            kind: "frame",
            storagePath,
            mimeType: "image/jpeg",
            bytes: bytes.length,
            checksum: await sha256Hex(bytes),
            meta: { itemId: file.itemId, atS },
          });
          await saveMediaFile({ id: assetId, storagePath, blob });
          frames.push({ assetId, atS });
        }
        release(video);
        return { frames, cutsAtS };
      } finally {
        URL.revokeObjectURL(url);
      }
    },

    // The file has a sound track (the probe said so): decoded here, or the
    // reason this browser could not.
    async audio(file, options) {
      const codec = codecs.get(file.itemId) ?? null;
      codecs.delete(file.itemId);
      options.signal?.throwIfAborted();
      let samples: Float32Array;
      try {
        samples = await decode16k(await blobOf(file));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
          `this browser could not decode its sound${codec ? ` (${codec})` : ""}: ${reason}. The self-hosted studio reads it with ffmpeg.`,
        );
      }
      if (samples.length === 0) throw new Error("its sound track is empty.");
      return { kind: "samples", samples, sampleRate: SAMPLE_RATE };
    },

    async picture(assetId) {
      const stored = await readMediaFile(assetId);
      if (!stored) throw new Error("The picture is no longer in this browser.");
      return { bytes: new Uint8Array(await stored.blob.arrayBuffer()), mimeType: stored.blob.type || "image/jpeg" };
    },

    async pdfText(file) {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(await (await blobOf(file)).arrayBuffer()));
      const { text } = await extractText(pdf, { mergePages: false });
      return (Array.isArray(text) ? text : [text])
        .map((page) => page.trim())
        .filter(Boolean)
        .join("\n\n");
    },
  };
}
