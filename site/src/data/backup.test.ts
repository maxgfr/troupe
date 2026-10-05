import { describe, expect, it } from "vitest";

import { backupFilename, packBackup, summarize, unpackBackup } from "./backup";
import { readTar, writeTar } from "./tar";

const database = {
  migrations: ["0000_init.sql", "0001_more.sql"],
  tables: { troupe_project: [{ id: "p1", title: "Kept" }, { id: "p2", title: "Also kept" }], troupe_script: [] },
};
const clip = (n: number) => new Blob([new Uint8Array(n).fill(7)], { type: "video/mp4" });
const media = [
  { id: "a1", storagePath: "browser/a1.mp4", blob: clip(1500) },
  { id: "a2", storagePath: "browser/a2.mp4", blob: clip(10) },
];
const now = new Date(2026, 9, 5, 9, 45);

describe("browser edition backups", () => {
  it("round-trips the database and every file", async () => {
    const { blob, filename } = packBackup({ database, media, now });
    expect(filename).toBe("troupe-backup-2026-10-05-0945.tar");
    const backup = await unpackBackup(blob);
    expect(backup.database).toEqual(database);
    expect(backup.createdAt.getTime()).toBe(now.getTime());
    expect(backup.media.map((m) => [m.id, m.storagePath, m.blob.type, m.blob.size])).toEqual([
      ["a1", "browser/a1.mp4", "video/mp4", 1500],
      ["a2", "browser/a2.mp4", "video/mp4", 10],
    ]);
    expect(new Uint8Array(await backup.media[0]!.blob.arrayBuffer())).toEqual(new Uint8Array(1500).fill(7));
    expect(summarize(backup)).toEqual({ createdAt: now, projects: 2, videos: 2, bytes: 1510 });
  });

  it("names the file with a zero-padded local date and time", () => {
    expect(backupFilename(new Date(2027, 0, 2, 3, 4))).toBe("troupe-backup-2027-01-02-0304.tar");
  });

  it("refuses other files, newer formats and incomplete backups, in words", async () => {
    await expect(unpackBackup(new Blob(["hello".repeat(200)]))).rejects.toThrow("This file is not a Troupe backup.");
    const other = writeTar([{ name: "notes.txt", data: new Blob(["hi"]) }]);
    await expect(unpackBackup(other)).rejects.toThrow("This file is not a Troupe backup.");

    const { blob } = packBackup({ database, media, now });
    const entries = await readTar(blob);
    const manifest = JSON.parse(await entries[0]!.data.text()) as Record<string, unknown>;
    const newer = writeTar([{ name: "troupe-backup.json", data: new Blob([JSON.stringify({ ...manifest, version: 2 })]) }, ...entries.slice(1)]);
    await expect(unpackBackup(newer)).rejects.toThrow(/newer version of Troupe/);
    const missing = writeTar(entries.slice(0, 2));
    await expect(unpackBackup(missing)).rejects.toThrow(/incomplete/);
    const damaged = writeTar([{ name: "troupe-backup.json", data: new Blob([JSON.stringify({ ...manifest, database: { tables: {} } })]) }]);
    await expect(unpackBackup(damaged)).rejects.toThrow(/damaged/);
  });
});
