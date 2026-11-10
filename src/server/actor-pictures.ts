import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { isCustomPicture } from "~/modules/actors/pictures";
import { mediaFilePath } from "~/server/media/storage";
import { removeFromSupabase, supabaseStorage, uploadToSupabase } from "~/server/media/supabase";
import { imageSize } from "~/server/media-sniff";
import { cropFor, dataUrl, type PictureBytes } from "~/server/picture-framing";

const run = promisify(execFile);

// An actor's pictures as bytes, for the models that take a picture: the
// checked-in cast from public/actors (or TROUPE_ACTOR_PORTRAITS_URL when it
// is a web address), an actor made in the studio from its media storage.
// The browser edition has its own (site/src/shims/actor-pictures.ts).

export { cropFor, dataUrl };
export type { PictureBytes };

const MAX_PICTURE_BYTES = 15 * 1024 * 1024;

const TYPE_BY_EXT: Record<string, string> = {
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

export function pictureType(storagePath: string): string {
  return TYPE_BY_EXT[storagePath.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

// The checked-in cast: public/<storagePath>, inside public/actors only.
function castFile(storagePath: string, cwd = process.cwd()): string {
  const root = resolve(cwd, "public", "actors");
  const file = resolve(cwd, "public", storagePath);
  if (!file.startsWith(`${root}${sep}`)) throw new Error("Invalid actor picture path.");
  return file;
}

const bucket = (env: Record<string, string | undefined>) => env.SUPABASE_STORAGE_BUCKET ?? "troupe-media";

export async function readActorPicture(
  storagePath: string,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<PictureBytes> {
  const mediaType = pictureType(storagePath);
  if (isCustomPicture(storagePath)) {
    const storage = supabaseStorage();
    if (storage) {
      const result = await storage.from(bucket(env)).download(storagePath);
      if (result.error || !result.data) throw new Error("This actor's picture could not be read from storage.");
      return { data: new Uint8Array(await result.data.arrayBuffer()), mediaType };
    }
    return { data: new Uint8Array(await readFile(mediaFilePath(storagePath))), mediaType };
  }
  const base = env.TROUPE_ACTOR_PORTRAITS_URL?.trim();
  if (base && /^https:\/\//i.test(base)) {
    const url = `${base.replace(/\/+$/, "")}/${storagePath.replace(/^actors\//, "")}`;
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`The actor's picture could not be loaded (HTTP ${response.status}).`);
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.length > MAX_PICTURE_BYTES) throw new Error("The actor's picture is too large.");
    return { data, mediaType };
  }
  return { data: new Uint8Array(await readFile(castFile(storagePath))), mediaType };
}

// Keep a picture of an actor made in the studio. In Supabase it goes to the
// private media bucket like the Shots page's photos; the picture route reads
// it back and serves it as the image it is.
export async function storeActorPicture(storagePath: string, picture: PictureBytes): Promise<void> {
  if (await uploadToSupabase(storagePath, picture.data)) return;
  if (process.env.VERCEL) throw new Error("Supabase storage must be configured on Vercel.");
  const destination = mediaFilePath(storagePath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, picture.data, { mode: 0o600 });
}

// Best effort: a picture already gone is fine.
export async function removeActorPictures(storagePaths: string[]): Promise<void> {
  if (!storagePaths.length) return;
  if (supabaseStorage()) {
    await removeFromSupabase(storagePaths).catch(() => {});
    return;
  }
  await Promise.allSettled(storagePaths.map((p) => rm(mediaFilePath(p), { force: true })));
}

export function ffmpegPath(env: Record<string, string | undefined> = process.env) {
  return env.FFMPEG_PATH?.trim() || "ffmpeg";
}

// The picture framed like the video (a model given a 3:4 portrait for a 9:16
// video letterboxes it, or renders 3:4), as a JPEG no wider than 1280 px.
// Without ffmpeg the picture goes as it is.
export async function frameForVideo(
  picture: PictureBytes,
  aspectRatio: string,
  env: Record<string, string | undefined> = process.env,
): Promise<PictureBytes> {
  const size = imageSize(picture.data);
  const crop = size ? cropFor(size.width, size.height, aspectRatio) : null;
  const scratch = await mkdtemp(join(tmpdir(), "troupe-frame-"));
  try {
    const input = join(scratch, `in.${picture.mediaType.split("/")[1] ?? "img"}`);
    const output = join(scratch, "out.jpg");
    await writeFile(input, picture.data, { mode: 0o600 });
    const filters = [
      ...(crop ? [`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`] : []),
      "scale='min(1280,iw)':-2",
    ];
    await run(
      ffmpegPath(env),
      ["-hide_banner", "-nostdin", "-v", "error", "-y", "-i", input, "-vf", filters.join(","), "-q:v", "3", output],
      { timeout: 30_000 },
    );
    return { data: new Uint8Array(await readFile(output)), mediaType: "image/jpeg" };
  } catch {
    return picture;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

// The actor's picture a video model starts from, framed like the video; null
// when it cannot be read, so the render goes on with the description alone.
export async function loadActorReference(storagePath: string, aspectRatio: string): Promise<string | null> {
  try {
    return dataUrl(await frameForVideo(await readActorPicture(storagePath), aspectRatio));
  } catch {
    return null;
  }
}

// The actor's picture as it is, for a photo model that draws from it.
export async function loadActorPicture(storagePath: string): Promise<string | null> {
  try {
    return dataUrl(await readActorPicture(storagePath));
  } catch {
    return null;
  }
}
