import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import type { Db } from "~/server/db/types";
import { ffprobePath, mediaFilePath } from "~/server/media/storage";
import { uploadToSupabase } from "~/server/media/supabase";
import {
  MEDIA_TIMEOUT_MS,
  mediaProviders,
  renderMediaShotWith,
  type KeepShotFile,
  type MediaRenderer,
  type MediaShotInput,
} from "~/server/shot-media-core";
import { imageSize, sniffMedia } from "~/server/media-sniff";

const run = promisify(execFile);

// The self-hosted studio's photos and voice clips (shot-media-core.ts), kept
// on its disk or in Supabase.

export { MEDIA_TIMEOUT_MS, imageSize, sniffMedia };
export type { MediaRenderer, MediaShotInput };

async function audioDurationS(path: string): Promise<number | null> {
  try {
    const { stdout } = await run(
      ffprobePath(),
      ["-v", "error", "-show_entries", "format=duration", "-of", "json", path],
      {
        timeout: 15_000,
      },
    );
    const value = Number((JSON.parse(stdout) as { format?: { duration?: string } }).format?.duration);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

const keepOnServer: KeepShotFile = async ({ storagePath, bytes, ext, medium }) => {
  const remote = await uploadToSupabase(storagePath, bytes);
  let durationS: number | null = null;
  const scratch = await mkdtemp(join(tmpdir(), "troupe-shot-"));
  try {
    const temporary = join(scratch, `file.${ext}`);
    await writeFile(temporary, bytes, { mode: 0o600 });
    if (medium === "speech") durationS = await audioDurationS(temporary);
    if (!remote) {
      if (process.env.VERCEL) throw new Error("Supabase storage must be configured on Vercel.");
      const destination = mediaFilePath(storagePath);
      await mkdir(dirname(destination), { recursive: true });
      await rename(temporary, destination).catch(async () => {
        await writeFile(destination, bytes, { mode: 0o600 });
      });
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  return { storage: remote ? "supabase" : "local", durationS };
};

// Render one photo or voice clip and keep it. The row is saved first (as a
// running shot), then completed with the file, or failed with a readable
// reason: a provider's refusal never throws past here.
export function renderMediaShot(db: Db, input: MediaShotInput, renderers: MediaRenderer = mediaProviders) {
  return renderMediaShotWith(db, input, keepOnServer, renderers);
}
