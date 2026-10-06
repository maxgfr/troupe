import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { mediaDisposition } from "~/server/media/store";
import { MEDIA_TYPES } from "./data/backup";

// The media service worker (site/public/sw.js) is plain JavaScript served as
// is, so it carries its own copies of mediaDisposition and of the playable
// types. These checks keep the copies in step with the originals.
const worker = readFileSync(join(import.meta.dirname, "..", "public", "sw.js"), "utf8");

function workerFunction<T extends (...args: never[]) => unknown>(name: string): T {
  const source = new RegExp(`^function ${name}\\(([^)]*)\\) \\{\\n([\\s\\S]*?)\\n\\}$`, "m").exec(worker);
  if (!source) throw new Error(`sw.js has no function ${name}.`);
  return new Function(...source[1]!.split(",").map((p) => p.trim()), source[2]!) as T;
}

describe("the media service worker", () => {
  it("names downloads exactly as mediaDisposition does", () => {
    const disposition = workerFunction<(download: string | null, ext: string) => string>("disposition");
    const downloads = [null, "1", "", "clip", "clip.mp4", "clip.webm", "CLIP.MP4", "spring-drop-renderer-2026-10-05-0945.mp4", "../etc/passwd", 'a"b.mp4', "spaced name.mp4", ".hidden", "x".repeat(119), "x".repeat(120), "x".repeat(200), "été.mp4"];
    for (const ext of ["mp4", "webm"] as const) {
      for (const download of downloads) expect(disposition(download, ext), `${download} (${ext})`).toBe(mediaDisposition(download, ext));
    }
  });

  const types = (name: string): string[] => {
    const found = new RegExp(`^const ${name} = new Set\\((\\[[^\\]]*\\])\\);$`, "m").exec(worker);
    if (!found) throw new Error(`sw.js has no ${name}.`);
    // One line or one type per line, with or without a trailing comma.
    return JSON.parse(found[1]!.replace(/,\s*\]$/, "]"));
  };

  it("serves inline, or as a download, exactly the types the backups accept", () => {
    expect([...types("INLINE"), ...types("DOWNLOAD_ONLY")].sort()).toEqual([...MEDIA_TYPES].sort());
    for (const type of types("PLAYABLE")) expect(types("INLINE")).toContain(type);
    for (const type of [...types("INLINE"), ...types("DOWNLOAD_ONLY")]) expect(type).not.toMatch(/html|svg|xml|javascript/);
  });
});
