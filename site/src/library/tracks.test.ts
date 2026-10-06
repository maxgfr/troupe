import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { readTracks, tooLongForBrowser } from "./tracks";

const dir = mkdtempSync(join(tmpdir(), "troupe-tracks-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const blob = (path: string, type: string) => new Blob([readFileSync(path)], { type });

describe("a saved file's tracks", () => {
  it("tells a clip with sound from one without a sound track, without decoding either", async () => {
    const clip = await readTracks(
      blob(join(import.meta.dirname, "..", "..", "tests", "fixtures", "library-clip.mp4"), "video/mp4"),
    );
    expect(clip).toMatchObject({ hasVideo: true, audioCodec: "aac" });
    expect(clip!.durationS).toBeGreaterThan(5);

    const silent = join(dir, "silent.mp4");
    execFileSync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=64x64:d=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      silent,
    ]);
    expect(await readTracks(blob(silent, "video/mp4"))).toMatchObject({ hasVideo: true, audioCodec: null });
  });

  it("gives up quietly on what it cannot read", async () => {
    expect(await readTracks(new Blob(["not a video"], { type: "video/mp4" }))).toBeNull();
  });

  it("says when a file is too long for the browser", () => {
    expect(tooLongForBrowser(14 * 60, 15)).toBeNull();
    expect(tooLongForBrowser(null, 15)).toBeNull();
    expect(tooLongForBrowser(40 * 60 + 5, 15)).toMatch(
      /41 minutes long, too long for this browser: it reads up to 15 minutes/,
    );
  });
});
