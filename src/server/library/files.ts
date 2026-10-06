import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, rmdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";

import { MAX_TEXT_CHARS, type ClaimedUpload } from "~/modules/library";
import { mediaFilePath, mediaRoot } from "~/server/media/storage";
import { EXTENSIONS, SNIFF_BYTES, sniffType } from "./sniff";

// The library's files in the data folder (TROUPE_DATA_DIR): the original at
// library/<item>/original.<ext>, pictures at library/<item>/frame-<n>.jpg.
// Originals stay on this server only: they are never sent anywhere else.

export class UploadRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadRefused";
  }
}

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

export const libraryPath = (itemId: string, file: string) => `library/${itemId}/${file}`;

// Where a file is received before it is checked: in the data folder, so the
// final move is a rename on the same disk.
async function incomingFile(): Promise<string> {
  const dir = join(mediaRoot(), "library", ".incoming");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return join(dir, randomUUID());
}

export type Received = { kind: "file"; file: ClaimedUpload } | { kind: "text"; text: string; fileName: string };

// Writes a stream to disk, counting bytes (refused past `maxBytes`) and
// hashing them, then decides from the first bytes what it is. A text file
// comes back as its words; anything else moves to the item's folder.
export async function receiveUpload(source: AsyncIterable<Uint8Array>, input: { itemId: string; fileName: string; maxBytes: number }): Promise<Received> {
  const temporary = await incomingFile();
  const hash = createHash("sha256");
  let size = 0;
  try {
    await pipeline(
      source,
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          size += chunk.length;
          if (size > input.maxBytes) return done(new UploadRefused(`The file is larger than ${mb(input.maxBytes)} (TROUPE_LIBRARY_MAX_UPLOAD_MB).`));
          hash.update(chunk);
          done(null, chunk);
        },
      }),
      createWriteStream(temporary, { mode: 0o600 }),
    );
    if (size === 0) throw new UploadRefused("The file is empty.");
    return await settle(temporary, { itemId: input.itemId, fileName: input.fileName, bytes: size, checksum: hash.digest("hex") });
  } finally {
    await rm(temporary, { force: true });
  }
}

// A file already on disk (yt-dlp's download, a fetched file), copied in.
export async function receiveFile(path: string, input: { itemId: string; fileName: string; maxBytes: number }): Promise<Received> {
  const { size } = await stat(path);
  if (size > input.maxBytes) throw new UploadRefused(`The file is larger than ${mb(input.maxBytes)} (TROUPE_LIBRARY_MAX_UPLOAD_MB).`);
  return receiveUpload(createReadStream(path), input);
}

async function settle(temporary: string, input: { itemId: string; fileName: string; bytes: number; checksum: string }): Promise<Received> {
  const handle = await open(temporary, "r");
  const head = new Uint8Array(SNIFF_BYTES);
  const { bytesRead } = await handle.read(head, 0, SNIFF_BYTES, 0);
  await handle.close();
  const mimeType = sniffType(head.subarray(0, bytesRead));
  if (!mimeType) throw new UploadRefused("This file is not one the library reads: use a video, a sound file, a picture (PNG, JPEG, WebP, GIF), a PDF or plain text.");
  if (mimeType === "text/plain") {
    // A character takes at most four bytes: past that, the text cannot fit.
    if (input.bytes > MAX_TEXT_CHARS * 4) throw new UploadRefused(`The text is longer than ${MAX_TEXT_CHARS.toLocaleString("en")} characters. Save a shorter part of it.`);
    const text = await readFile(temporary, "utf8");
    return { kind: "text", text, fileName: input.fileName };
  }
  const storagePath = libraryPath(input.itemId, `original.${EXTENSIONS[mimeType]}`);
  const destination = mediaFilePath(storagePath);
  await mkdir(dirname(destination), { recursive: true });
  await rename(temporary, destination);
  return { kind: "file", file: { assetId: randomUUID(), storagePath, mimeType, bytes: input.bytes, checksum: input.checksum, fileName: input.fileName } };
}

// A name fit to show: no folders, no control characters, at most 200 characters.
export function cleanFileName(raw: string | null | undefined): string {
  const name = (raw ?? "").split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return name.slice(0, 200) || "upload";
}

// Removes stored files once their rows are gone; a missing one is fine. The
// item's folder goes once empty.
export async function removeLibraryFiles(files: { storagePath: string }[]): Promise<void> {
  const folders = new Set<string>();
  for (const file of files) {
    const path = mediaFilePath(file.storagePath);
    await rm(path, { force: true });
    folders.add(dirname(path));
  }
  for (const folder of folders) {
    // rmdir removes a folder only when it is empty, which is the point.
    if (folder.startsWith(join(mediaRoot(), "library"))) await rmdir(folder).catch(() => {});
  }
}
