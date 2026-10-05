// A plain tar archive (POSIX ustar, no compression), written and read as
// Blobs: the backup's files are referenced, never copied into one buffer, so
// a backup full of videos costs no more memory than its largest header. Any
// tar tool can list or unpack one (`tar -tf troupe-backup-….tar`).

const BLOCK = 512;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface TarEntry {
  name: string;
  data: Blob;
}

function field(header: Uint8Array<ArrayBuffer>, offset: number, length: number, value: string) {
  const bytes = encoder.encode(value);
  if (bytes.length > length) throw new Error(`"${value}" does not fit in a tar header.`);
  header.set(bytes, offset);
}

// Numbers are octal, zero-padded, ending with a NUL.
const octal = (value: number, length: number) => value.toString(8).padStart(length - 1, "0");

function headerFor(name: string, size: number, mtime: number): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(BLOCK);
  field(header, 0, 100, name);
  field(header, 100, 8, octal(0o644, 8));
  field(header, 108, 8, octal(0, 8));
  field(header, 116, 8, octal(0, 8));
  field(header, 124, 12, octal(size, 12));
  field(header, 136, 12, octal(Math.floor(mtime / 1000), 12));
  header.fill(0x20, 148, 156); // the checksum counts its own field as spaces
  field(header, 156, 1, "0");
  field(header, 257, 6, "ustar\0");
  field(header, 263, 2, "00");
  const sum = header.reduce((total, byte) => total + byte, 0);
  field(header, 148, 8, `${octal(sum, 7)}\0`);
  return header;
}

const padding = (size: number) => new Uint8Array((BLOCK - (size % BLOCK)) % BLOCK);

export function writeTar(entries: readonly TarEntry[], mtime = Date.now()): Blob {
  const parts: BlobPart[] = [];
  for (const { name, data } of entries) {
    parts.push(headerFor(name, data.size, mtime), data, padding(data.size));
  }
  parts.push(new Uint8Array(BLOCK * 2));
  return new Blob(parts, { type: "application/x-tar" });
}

const text = (bytes: Uint8Array) => {
  const end = bytes.indexOf(0);
  return decoder.decode(end === -1 ? bytes : bytes.subarray(0, end));
};

export class NotATarError extends Error {
  constructor() {
    super("This file is not a Troupe backup.");
    this.name = "NotATarError";
  }
}

// The regular files of an archive, each a slice of the given Blob.
export async function readTar(archive: Blob): Promise<TarEntry[]> {
  const entries: TarEntry[] = [];
  let offset = 0;
  while (offset + BLOCK <= archive.size) {
    const header = new Uint8Array(await archive.slice(offset, offset + BLOCK).arrayBuffer());
    if (header.every((byte) => byte === 0)) return entries;
    if (text(header.subarray(257, 262)) !== "ustar") throw new NotATarError();
    const stored = text(header.subarray(148, 156)).trim();
    header.fill(0x20, 148, 156);
    if (Number.parseInt(stored, 8) !== header.reduce((total, byte) => total + byte, 0)) throw new NotATarError();
    const size = Number.parseInt(text(header.subarray(124, 136)).trim() || "0", 8);
    const prefix = text(header.subarray(345, 500));
    const name = (prefix ? `${prefix}/` : "") + text(header.subarray(0, 100));
    const type = String.fromCharCode(header[156] ?? 0);
    const start = offset + BLOCK;
    if (start + size > archive.size) throw new Error("This backup is incomplete: it ends in the middle of a file.");
    if (type === "0" || type === "\0") entries.push({ name, data: archive.slice(start, start + size) });
    offset = start + size + padding(size).length;
  }
  if (entries.length === 0) throw new NotATarError();
  return entries;
}
