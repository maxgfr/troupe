import { describe, expect, it } from "vitest";

import { downloadFileName, mediaDisposition } from "./store";

describe("mediaDisposition", () => {
  it("plays inline without a download query", () => {
    expect(mediaDisposition(null)).toBe('inline; filename="troupe-video.mp4"');
  });

  it("saves under the name the link asks for", () => {
    expect(mediaDisposition("spring-drop-renderer-2026-10-05-0945.mp4")).toBe('attachment; filename="spring-drop-renderer-2026-10-05-0945.mp4"');
    expect(mediaDisposition("spring-drop", "webm")).toBe('attachment; filename="spring-drop.webm"');
  });

  it("falls back to troupe-video for the legacy flag and anything that is not a plain file name", () => {
    for (const value of ["1", "", "../etc/passwd", 'a"b.mp4', "spaced name.mp4", "x".repeat(200)]) {
      expect(mediaDisposition(value)).toBe('attachment; filename="troupe-video.mp4"');
    }
  });
});

describe("downloadFileName", () => {
  it("is the name a download is saved under, or null to play inline", () => {
    expect(downloadFileName(null)).toBeNull();
    expect(downloadFileName("clip.mp4")).toBe("clip.mp4");
    expect(downloadFileName("1")).toBe("troupe-video.mp4");
    expect(downloadFileName("../x.mp4", "webm")).toBe("troupe-video.webm");
  });
});
