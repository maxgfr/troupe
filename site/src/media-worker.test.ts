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

  it("plays the same types the backups accept", () => {
    const playable = /^const PLAYABLE = new Set\((\[[^\]]*\])\);$/m.exec(worker);
    expect(playable).not.toBeNull();
    expect(JSON.parse(playable![1]!)).toEqual([...MEDIA_TYPES]);
  });
});
