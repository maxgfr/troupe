import type * as Real from "~/server/actor-pictures";
import { actorPictureUrl, isCustomPicture } from "~/modules/actors/pictures";
import { cropFor, dataUrl, type PictureBytes } from "~/server/picture-framing";
import { deleteMediaFiles, readMediaFile, saveMediaFile } from "../media";

// Stands in for src/server/actor-pictures.ts in the browser edition: the
// cast's pictures come from the site (<base>actors/), the pictures of an
// actor made in this browser live with its renders in IndexedDB (under their
// storage path, where the media service worker serves them), and a picture
// is framed for a video on a canvas instead of with ffmpeg.

export { cropFor, dataUrl };
export type { PictureBytes };

const TYPE_BY_EXT: Record<string, string> = {
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

export function pictureType(storagePath: string): string {
  return TYPE_BY_EXT[storagePath.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

export async function readActorPicture(storagePath: string): Promise<PictureBytes> {
  const mediaType = pictureType(storagePath);
  if (isCustomPicture(storagePath)) {
    const file = await readMediaFile(storagePath);
    if (!file) throw new Error("This actor's picture is no longer in this browser.");
    return { data: new Uint8Array(await file.blob.arrayBuffer()), mediaType };
  }
  const response = await fetch(actorPictureUrl(`${import.meta.env.BASE_URL}actors`, storagePath));
  if (!response.ok) throw new Error(`The actor's picture could not be loaded (HTTP ${response.status}).`);
  return { data: new Uint8Array(await response.arrayBuffer()), mediaType };
}

export async function storeActorPicture(storagePath: string, picture: PictureBytes): Promise<void> {
  await saveMediaFile({
    id: storagePath,
    storagePath,
    blob: new Blob([picture.data as Uint8Array<ArrayBuffer>], { type: picture.mediaType }),
  });
}

export async function removeActorPictures(storagePaths: string[]): Promise<void> {
  await deleteMediaFiles(storagePaths).catch(() => {});
}

export function ffmpegPath(): string {
  return "";
}

// The picture framed like the video, as a JPEG no wider than 1280 px, drawn
// on a canvas. A picture the browser cannot decode goes as it is.
export async function frameForVideo(picture: PictureBytes, aspectRatio: string): Promise<PictureBytes> {
  try {
    const bitmap = await createImageBitmap(
      new Blob([picture.data as Uint8Array<ArrayBuffer>], { type: picture.mediaType }),
    );
    const crop = cropFor(bitmap.width, bitmap.height, aspectRatio) ?? {
      width: bitmap.width,
      height: bitmap.height,
      x: 0,
      y: 0,
    };
    const scale = Math.min(1, 1280 / crop.width);
    const width = Math.round(crop.width * scale);
    const height = Math.round(crop.height * scale);
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d")!.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
    return { data: new Uint8Array(await blob.arrayBuffer()), mediaType: "image/jpeg" };
  } catch {
    return picture;
  }
}

export async function loadActorReference(storagePath: string, aspectRatio: string): Promise<string | null> {
  try {
    return dataUrl(await frameForVideo(await readActorPicture(storagePath), aspectRatio));
  } catch {
    return null;
  }
}

export async function loadActorPicture(storagePath: string): Promise<string | null> {
  try {
    return dataUrl(await readActorPicture(storagePath));
  } catch {
    return null;
  }
}

// Fails the typecheck when the real module's exports change shape.
({
  cropFor,
  dataUrl,
  pictureType,
  readActorPicture,
  storeActorPicture,
  removeActorPictures,
  ffmpegPath,
  frameForVideo,
  loadActorReference,
  loadActorPicture,
}) satisfies Record<keyof typeof Real, unknown>;
