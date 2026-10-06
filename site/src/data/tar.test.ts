import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readTar, writeTar } from "./tar";

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

const bytes = (n: number) => new Uint8Array(n).map((_, i) => (i * 7) % 256);

describe("tar archives", () => {
  it("reads back what it writes, sizes that fill a block exactly included", async () => {
    const entries = [
      { name: "troupe-backup.json", data: new Blob(['{"a":1}']) },
      { name: "media/one", data: new Blob([bytes(512)]) },
      { name: "media/two", data: new Blob([bytes(1300)]) },
      { name: "media/empty", data: new Blob([]) },
    ];
    const archive = writeTar(entries);
    expect(archive.size % 512).toBe(0);
    const read = await readTar(archive);
    expect(read.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    for (const [i, entry] of read.entries()) {
      expect(new Uint8Array(await entry.data.arrayBuffer())).toEqual(
        new Uint8Array(await entries[i]!.data.arrayBuffer()),
      );
    }
  });

  it("writes an archive the system tar lists and unpacks", async () => {
    dir = mkdtempSync(join(tmpdir(), "troupe-tar-"));
    const file = join(dir, "backup.tar");
    writeFileSync(
      file,
      new Uint8Array(await writeTar([{ name: "media/clip", data: new Blob([bytes(2000)]) }]).arrayBuffer()),
    );
    expect(execFileSync("tar", ["-tf", file], { encoding: "utf8" }).trim()).toBe("media/clip");
    execFileSync("tar", ["-xf", file, "-C", dir]);
    expect(new Uint8Array(readFileSync(join(dir, "media", "clip")))).toEqual(bytes(2000));
  });

  it("refuses a file that is not a tar archive, or one cut short", async () => {
    await expect(readTar(new Blob(["not an archive at all".repeat(40)]))).rejects.toThrow("not a Troupe backup");
    await expect(readTar(new Blob([]))).rejects.toThrow("not a Troupe backup");
    const archive = writeTar([{ name: "media/clip", data: new Blob([bytes(5000)]) }]);
    await expect(readTar(archive.slice(0, 2048))).rejects.toThrow(/incomplete/);
  });
});
