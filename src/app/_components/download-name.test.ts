import { describe, expect, it } from "vitest";

import { mediaDisposition } from "~/server/media/store";
import { downloadUrl, renderFileName } from "./download-name";

describe("renderFileName", () => {
  const createdAt = new Date(2026, 9, 5, 9, 45);

  it("names the file after the project, the model and the time of the render", () => {
    expect(renderFileName({ project: "Spring drop — short video", model: "Local renderer", createdAt })).toBe("spring-drop-short-video-local-renderer-2026-10-05-0945.mp4");
  });

  it("keeps accented names readable and drops what is missing", () => {
    expect(renderFileName({ project: "Café Zoé", model: null, createdAt })).toBe("cafe-zoe-2026-10-05-0945.mp4");
    expect(renderFileName({ project: "", model: "", createdAt: "not a date" })).toBe("troupe-video.mp4");
  });

  it("is a name the media route accepts as is", () => {
    const name = renderFileName({ project: "A".repeat(90), model: "B".repeat(90), createdAt });
    expect(mediaDisposition(name)).toBe(`attachment; filename="${name}"`);
  });
});

describe("downloadUrl", () => {
  it("adds the name as the download query", () => {
    expect(downloadUrl("/api/media/abc", "clip.mp4")).toBe("/api/media/abc?download=clip.mp4");
    expect(downloadUrl("/troupe/app/media/abc?v=2", "clip.mp4")).toBe("/troupe/app/media/abc?v=2&download=clip.mp4");
  });
});
