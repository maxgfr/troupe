import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, copyFile, rename, rm } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { removeFromSupabase, uploadToSupabase } from "./supabase";

import { ingestRender, type RenderIngestor } from "~/modules/generation";

const run = promisify(execFile);
export function mediaRoot() { return resolve(process.env.TROUPE_DATA_DIR ?? "data"); }

export function mediaFilePath(storagePath: string) {
  const root = mediaRoot();
  const path = resolve(root, storagePath);
  if (!path.startsWith(`${root}${sep}`)) throw new Error("Invalid media path.");
  return path;
}

// Write to a temporary file, validate actual media, then publish atomically.
// A database rollback can safely retry: the destination is deterministic.
export const persistProviderRender: RenderIngestor = async (db, gen, status, adapter) => {
  if (gen.outputAssetId) return;
  if (!status.outputUrl || !adapter.downloadResult) throw new Error("Provider returned no downloadable video.");
  const bytes = await adapter.downloadResult(status.outputUrl);
  const storagePath = `renders/${gen.projectId}/${gen.id}.mp4`;
  const destination = mediaFilePath(storagePath);
  const scratch = await mkdtemp(join(tmpdir(), "troupe-render-"));
  const temporary = join(scratch, "video.mp4");
  try {
    await writeFile(temporary, bytes, { mode: 0o600 });
    const { stdout } = await run(process.env.VERCEL ? join(process.cwd(), "node_modules/@ffprobe-installer/linux-x64/ffprobe") : "ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", temporary], { timeout: 15_000 });
    const probe = JSON.parse(stdout) as { streams?: { width: number; height: number }[]; format?: { duration: string } };
    const stream = probe.streams?.[0];
    const durationS = Number(probe.format?.duration);
    if (!stream || !Number.isFinite(durationS) || durationS <= 0) throw new Error("Downloaded video could not be read.");
    const remote = await uploadToSupabase(storagePath, bytes);
    if (!remote) {
      if (process.env.VERCEL) throw new Error("Supabase storage must be configured on Vercel.");
      await mkdir(dirname(destination), { recursive: true });
      const staged = `${destination}.tmp`;
      await copyFile(temporary, staged);
      await rename(staged, destination);
    }
    await ingestRender(db, {
      generationId: gen.id,
      bytes: bytes.length,
      checksum: createHash("sha256").update(bytes).digest("hex"),
      probe: async () => ({ durationS, width: stream.width, height: stream.height, storage: remote ? "supabase" : "local" }),
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
};

// Delete stored render files after their rows are gone. Best effort: a file
// that is already missing is fine.
export async function removeStoredMedia(files: { storagePath: string; storage: "local" | "supabase" }[]) {
  await Promise.all(files.filter((f) => f.storage === "local").map((f) => rm(mediaFilePath(f.storagePath), { force: true })));
  await removeFromSupabase(files.filter((f) => f.storage === "supabase").map((f) => f.storagePath));
}
