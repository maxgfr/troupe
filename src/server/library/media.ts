import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";

import type { Db } from "~/server/db/types";
import { mediaAssets } from "~/modules/generation";
import type { MediaReader } from "~/modules/library";
import { ffprobePath, mediaFilePath } from "~/server/media/storage";
import { libraryPath } from "./files";

// The library's media work with ffmpeg and ffprobe, which the app image
// already has: the length and tracks of a file, its opening frame and one
// after each cut (scene detection), its sound as 16 kHz mono FLAC for
// Whisper, and a PDF's text. Every program runs with an argument list and a
// time limit; temporary files live in a folder of their own.

const run = promisify(execFile);

// ffmpeg, with its log (stderr) for the cut times. Arguments only, no shell.
function ffmpeg(program: string, args: string[], options: { timeoutMs: number; signal?: AbortSignal }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, ["-hide_banner", "-nostdin", ...args], { stdio: ["ignore", "ignore", "pipe"], timeout: options.timeoutMs, signal: options.signal });
    let log = "";
    child.stderr.on("data", (chunk: Buffer) => {
      log += chunk.toString();
      if (log.length > 4_000_000) log = log.slice(-2_000_000);
    });
    child.on("error", (error: Error & { code?: string }) => reject(error.code === "ENOENT" ? new Error(`${program} is not installed on this server (FFMPEG_PATH).`) : error));
    child.on("close", (code, signal) => {
      if (code === 0) resolve(log);
      else reject(new Error(signal ? `ffmpeg was stopped (${signal}); the file may be too long` : `ffmpeg could not read the file: ${log.trim().split("\n").at(-1)?.slice(0, 200) ?? `exit ${code}`}`));
    });
  });
}

// A scene change: more than this share of the picture differs from the last frame.
const SCENE = 0.3;

export function cutTimes(log: string): number[] {
  return [...log.matchAll(/pts_time:\s*([\d.]+)/g)].map((m) => Number(m[1])).filter((t) => Number.isFinite(t));
}

export function frameTimes(cuts: readonly number[], durationS: number | null, max: number): number[] {
  const opening = durationS && durationS < 1 ? durationS / 2 : 0.5;
  const after = cuts.filter((t) => t > opening + 0.5).map((t) => t + 0.2);
  // Spread over the cuts when there are more than room for.
  const room = Math.max(0, max - 1);
  const chosen = after.length <= room ? after : Array.from({ length: room }, (_, i) => after[Math.round((i * (after.length - 1)) / Math.max(1, room - 1))]!);
  // A video without cuts still gets a few pictures across its length.
  if (chosen.length === 0 && durationS && durationS > 4 && room > 0) {
    const n = Math.min(room, 3);
    for (let i = 1; i <= n; i++) chosen.push(Math.round(((durationS * i) / (n + 1)) * 10) / 10);
  }
  return [opening, ...chosen].map((t) => Math.round(t * 100) / 100);
}

export function serverMediaReader(db: Db, settings: { ffmpegPath: string; timeoutMs?: number }): MediaReader {
  const timeoutMs = settings.timeoutMs ?? 20 * 60_000;
  return {
    async probe(item) {
      const { stdout } = await run(ffprobePath(), ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", mediaFilePath(item.storagePath)], { timeout: 60_000 });
      const probe = JSON.parse(stdout) as { streams?: { codec_type?: string }[]; format?: { duration?: string } };
      const durationS = Number(probe.format?.duration);
      const types = new Set((probe.streams ?? []).map((s) => s.codec_type));
      return { durationS: Number.isFinite(durationS) && durationS > 0 ? Math.round(durationS * 100) / 100 : null, hasVideo: types.has("video"), hasAudio: types.has("audio") };
    },

    async frames(item, options) {
      const input = mediaFilePath(item.storagePath);
      // Small frames are enough to see a cut, and far quicker to compare.
      const log = await ffmpeg(settings.ffmpegPath, ["-i", input, "-an", "-sn", "-dn", "-vf", `scale=320:-2,select='gt(scene,${SCENE})',showinfo`, "-f", "null", "-"], { timeoutMs, signal: options.signal });
      const cutsAtS = cutTimes(log);
      const frames: { assetId: string; atS: number }[] = [];
      for (const [n, atS] of frameTimes(cutsAtS, options.durationS, options.max).entries()) {
        if (options.durationS && atS >= options.durationS) continue;
        const storagePath = libraryPath(item.itemId, `frame-${String(n).padStart(2, "0")}.jpg`);
        const output = mediaFilePath(storagePath);
        await ffmpeg(settings.ffmpegPath, ["-y", "-ss", String(atS), "-i", input, "-frames:v", "1", "-vf", "scale='min(640,iw)':-2", "-q:v", "4", output], { timeoutMs: 60_000, signal: options.signal });
        const bytes = await readFile(output).catch(() => null);
        if (!bytes || bytes.length === 0) continue;
        const assetId = randomUUID();
        await db.insert(mediaAssets).values({ id: assetId, workspaceId: item.workspaceId, kind: "frame", storagePath, mimeType: "image/jpeg", bytes: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex"), meta: { itemId: item.itemId, atS, storage: "local" } });
        frames.push({ assetId, atS });
      }
      return { frames, cutsAtS };
    },

    async audio(item, options) {
      const dir = await mkdtemp(join(tmpdir(), "troupe-audio-"));
      const path = join(dir, "audio.flac");
      try {
        await ffmpeg(settings.ffmpegPath, ["-i", mediaFilePath(item.storagePath), "-vn", "-sn", "-dn", "-ac", "1", "-ar", "16000", "-c:a", "flac", path], { timeoutMs, signal: options.signal });
        await stat(path);
      } catch (error) {
        await rm(dir, { recursive: true, force: true });
        throw error;
      }
      return { kind: "file", path, dispose: () => rm(dir, { recursive: true, force: true }) };
    },

    async picture(assetId) {
      const [asset] = await db.select({ storagePath: mediaAssets.storagePath, mimeType: mediaAssets.mimeType }).from(mediaAssets).where(eq(mediaAssets.id, assetId)).limit(1);
      if (!asset) throw new Error("The picture is missing.");
      return { bytes: new Uint8Array(await readFile(mediaFilePath(asset.storagePath))), mimeType: asset.mimeType };
    },

    async pdfText(item) {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(await readFile(mediaFilePath(item.storagePath))));
      const { text } = await extractText(pdf, { mergePages: false });
      return (Array.isArray(text) ? text : [text]).map((page) => page.trim()).filter(Boolean).join("\n\n");
    },
  };
}
