import { describe, expect, it } from "vitest";

import { downloadFileName, libraryMediaHeaders, mediaDisposition } from "./store";

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

describe("libraryMediaHeaders", () => {
  it("serves media and pictures inline, a PDF and anything else as a download", () => {
    expect(libraryMediaHeaders("image/jpeg", null)).toEqual({ contentType: "image/jpeg", disposition: 'inline; filename="troupe-library.jpeg"' });
    expect(libraryMediaHeaders("video/mp4", "1")).toEqual({ contentType: "video/mp4", disposition: 'attachment; filename="troupe-library.mp4"' });
    expect(libraryMediaHeaders("application/pdf", null)).toEqual({ contentType: "application/pdf", disposition: 'attachment; filename="troupe-library.pdf"' });
    expect(libraryMediaHeaders("text/html", null)).toEqual({ contentType: "application/octet-stream", disposition: 'attachment; filename="troupe-library.html"' });
    expect(libraryMediaHeaders("image/svg+xml", null).contentType).toBe("application/octet-stream");
  });
});
