import type { BackupSummary } from "~/app/_components/edition";
import { BackupTooNewError, type PgliteSnapshot } from "~/server/db/pglite-migrate";
import type { MediaFile } from "../media";
import { readTar, writeTar } from "./tar";

// A backup of the browser edition: one tar file holding
//
//   troupe-backup.json   this manifest: the database (every table's rows and
//                        the migrations it had applied) and the list of files
//   media/<asset id>     each render, as stored in IndexedDB
//
// Version 1. A later version may add fields; this one refuses what it cannot
// read rather than guess. The database part is plain JSON, so a backup made
// before a migration is brought up to date when it is imported
// (restorePglite in src/server/db/pglite-migrate.ts).

export const BACKUP_FORMAT = "troupe-backup";
export const BACKUP_VERSION = 1;
const MANIFEST = "troupe-backup.json";
// What the studio stores: renders (MP4, src/modules/generation) and the
// library's files (src/server/library/sniff.ts names them by their bytes).
// The media service worker serves the playable ones inline from the studio's
// own origin, so nothing else may come in, an HTML or SVG file least of all.
export const MEDIA_TYPES: readonly string[] = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mp4",
  "audio/mpeg",
  "audio/aac",
  "audio/wav",
  "audio/ogg",
  "audio/flac",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
];
// Asset ids are UUIDs; they also name the archive entries.
const MEDIA_ID = /^[A-Za-z0-9_-]{1,64}$/;
const mediaPath = (id: string) => `media/${id}`;

interface Manifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  database: PgliteSnapshot;
  media: { id: string; storagePath: string; type: string; size: number }[];
}

export interface Backup {
  createdAt: Date;
  database: PgliteSnapshot;
  media: MediaFile[];
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

const NOT_A_BACKUP = "This file is not a Troupe backup.";

// troupe-backup-2026-10-05-0945.tar, in local time like the video downloads.
export function backupFilename(now: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `troupe-backup-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}.tar`;
}

export function packBackup(input: { database: PgliteSnapshot; media: readonly MediaFile[]; now?: Date }): { blob: Blob; filename: string } {
  const now = input.now ?? new Date();
  const manifest: Manifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: now.toISOString(),
    database: input.database,
    // The media service worker serves an untyped file as MP4 too.
    media: input.media.map((file) => ({ id: file.id, storagePath: file.storagePath, type: file.blob.type || "video/mp4", size: file.blob.size })),
  };
  const blob = writeTar(
    [
      { name: MANIFEST, data: new Blob([JSON.stringify(manifest)], { type: "application/json" }) },
      ...input.media.map((file) => ({ name: mediaPath(file.id), data: file.blob })),
    ],
    now.getTime(),
  );
  return { blob, filename: backupFilename(now) };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";

export function checkManifest(value: unknown): Manifest {
  if (!isRecord(value) || value.format !== BACKUP_FORMAT) throw new BackupError(NOT_A_BACKUP);
  if (typeof value.version !== "number" || !Number.isInteger(value.version) || value.version < 1) throw new BackupError(NOT_A_BACKUP);
  if (value.version > BACKUP_VERSION) {
    throw new BackupError("This backup was made by a newer version of Troupe. Reload the page to get the latest version, then import it again.");
  }
  const { database, media, createdAt } = value;
  const valid =
    isString(createdAt) &&
    !Number.isNaN(Date.parse(createdAt)) &&
    isRecord(database) &&
    Array.isArray(database.migrations) &&
    database.migrations.every(isString) &&
    isRecord(database.tables) &&
    Object.values(database.tables).every(Array.isArray) &&
    Array.isArray(media) &&
    media.every(
      (m) =>
        isRecord(m) &&
        isString(m.id) &&
        MEDIA_ID.test(m.id) &&
        isString(m.storagePath) &&
        isString(m.type) &&
        MEDIA_TYPES.includes(m.type) &&
        Number.isSafeInteger(m.size) &&
        (m.size as number) >= 0,
    );
  if (!valid) throw new BackupError("This backup is damaged: its contents list cannot be read.");
  return value as unknown as Manifest;
}

// Reads and checks a backup without changing anything.
export async function unpackBackup(file: Blob): Promise<Backup> {
  let entries: Awaited<ReturnType<typeof readTar>>;
  try {
    entries = await readTar(file);
  } catch (cause) {
    throw new BackupError(cause instanceof Error && cause.name !== "NotATarError" ? cause.message : NOT_A_BACKUP);
  }
  const files = new Map(entries.map((entry) => [entry.name, entry.data]));
  const manifestFile = files.get(MANIFEST);
  if (!manifestFile) throw new BackupError(NOT_A_BACKUP);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await manifestFile.text());
  } catch {
    throw new BackupError("This backup is damaged: its contents list cannot be read.");
  }
  const manifest = checkManifest(parsed);
  const media = manifest.media.map((entry) => {
    const data = files.get(mediaPath(entry.id));
    if (!data || data.size !== entry.size) throw new BackupError("This backup is incomplete: a video it lists is missing or cut short.");
    return { id: entry.id, storagePath: entry.storagePath, blob: new Blob([data], { type: entry.type }) };
  });
  return { createdAt: new Date(manifest.createdAt), database: manifest.database, media };
}

// A backup from a build with migrations this one does not have would need
// that build to restore it: refused before anything is shown or written.
export function checkMigrations(backup: Backup, known: readonly string[]): void {
  const have = new Set(known);
  const unknown = backup.database.migrations.filter((name) => !have.has(name));
  if (unknown.length > 0) throw new BackupTooNewError(unknown);
}

export function summarize(backup: Backup): BackupSummary {
  return {
    createdAt: backup.createdAt,
    projects: backup.database.tables.troupe_project?.length ?? 0,
    // Renders: the library's files are counted with the database's rows.
    videos: backup.media.filter((file) => !file.storagePath.startsWith("library/")).length,
    bytes: backup.media.reduce((total, file) => total + file.blob.size, 0),
  };
}
