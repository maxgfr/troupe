import { sha256Hex } from "~/modules/library/hash";
import { cutsFromDifferences, frameTimes, type MediaReader, type StoredItemFile } from "~/modules/library";
import { mediaAssets } from "~/modules/generation";
import type { Db } from "~/server/db/types";
import { readMediaFile, saveMediaFile } from "../media";

// The library's media work in the page: a video element and a canvas take
// the pictures (cuts found by comparing small frames every half second), Web
// Audio decodes the sound and resamples it to 16 kHz for Whisper. Workers
// have neither, so this runs in the tab that analyses.

const SAMPLE_RATE = 16000;
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
    element.muted = true;
    element.preload = "auto";
    element.onloadedmetadata = () => resolve(element);
    element.onerror = () => reject(new Error("This browser cannot play the file."));
    element.src = url;
  });
}

function seek(video: HTMLVideoElement, atS: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      resolve();
    };
    video.addEventListener("seeked", done);
    video.currentTime = atS;
  });
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The picture could not be saved."))), "image/jpeg", 0.82));
}

// Decoded sound by item: probe decodes it once, the transcription reuses it.
const decoded = new Map<string, Float32Array | null>();

async function decode(blob: Blob): Promise<Float32Array | null> {
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(buffer.duration * SAMPLE_RATE)), SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start();
    return (await offline.startRendering()).getChannelData(0);
  } catch {
    return null;
  } finally {
    await context.close().catch(() => {});
  }
}

export function browserMediaReader(db: Db): MediaReader {
  return {
    async probe(file) {
      const blob = await blobOf(file);
      const url = URL.createObjectURL(blob);
      try {
        const element = await media(url, file.mimeType.startsWith("audio/") ? "audio" : "video");
        const durationS = Number.isFinite(element.duration) ? Math.round(element.duration * 100) / 100 : null;
        const hasVideo = element instanceof HTMLVideoElement && element.videoWidth > 0;
        const samples = await decode(blob);
        decoded.set(file.itemId, samples);
        return { durationS, hasVideo, hasAudio: samples !== null && samples.length > 0 };
      } finally {
        URL.revokeObjectURL(url);
      }
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
          if (options.signal?.aborted) throw new Error("Stopped.");
          await seek(video, t);
          small.drawImage(video, 0, 0, COMPARE_W, COMPARE_H);
          const pixels = small.getImageData(0, 0, COMPARE_W, COMPARE_H).data;
          if (previous) {
            let sum = 0;
            for (let i = 0; i < pixels.length; i += 4) sum += Math.abs(pixels[i]! - previous[i]!) + Math.abs(pixels[i + 1]! - previous[i + 1]!) + Math.abs(pixels[i + 2]! - previous[i + 2]!);
            differences.push(sum / ((pixels.length / 4) * 3 * 255));
          }
          previous = pixels;
        }
        const cutsAtS = cutsFromDifferences(differences, step);
        const scale = Math.min(1, FRAME_W / video.videoWidth);
        const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(video.videoWidth * scale), height: Math.round(video.videoHeight * scale) });
        const context = canvas.getContext("2d")!;
        const frames: { assetId: string; atS: number }[] = [];
        for (const [n, atS] of frameTimes(cutsAtS, durationS, options.max).entries()) {
          if (atS >= durationS) continue;
          await seek(video, atS);
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const blob = await canvasBlob(canvas);
          const assetId = crypto.randomUUID();
          const storagePath = `library/${file.itemId}/frame-${String(n).padStart(2, "0")}.jpg`;
          const bytes = new Uint8Array(await blob.arrayBuffer());
          await db.insert(mediaAssets).values({ id: assetId, workspaceId: file.workspaceId, kind: "frame", storagePath, mimeType: "image/jpeg", bytes: bytes.length, checksum: await sha256Hex(bytes), meta: { itemId: file.itemId, atS } });
          await saveMediaFile({ id: assetId, storagePath, blob });
          frames.push({ assetId, atS });
        }
        return { frames, cutsAtS };
      } finally {
        URL.revokeObjectURL(url);
      }
    },

    async audio(file) {
      let samples = decoded.get(file.itemId);
      if (samples === undefined) samples = await decode(await blobOf(file));
      decoded.delete(file.itemId);
      if (!samples) throw new Error("This browser cannot decode the file's sound.");
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
      return (Array.isArray(text) ? text : [text]).map((page) => page.trim()).filter(Boolean).join("\n\n");
    },
  };
}
