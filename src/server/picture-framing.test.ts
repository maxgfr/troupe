import { describe, expect, it } from "vitest";

import { cropFor, dataUrl } from "./picture-framing";

describe("cropFor", () => {
  it("keeps the whole height of a portrait for a vertical video, centred across", () => {
    // 3:4 → 9:16: narrower.
    expect(cropFor(768, 1024, "9:16")).toEqual({ width: 576, height: 1024, x: 96, y: 0 });
  });

  it("keeps the whole width for a landscape video, from a little above the middle, where the face is", () => {
    const crop = cropFor(768, 1024, "16:9")!;
    expect(crop).toMatchObject({ width: 768, height: 432 });
    expect(crop.y).toBe(Math.floor((1024 - 432) * 0.3));
  });

  it("leaves a picture that already has the format, and refuses a format it cannot read", () => {
    expect(cropFor(720, 1280, "9:16")).toBeNull();
    expect(cropFor(720, 1280, "wide")).toBeNull();
  });
});

describe("dataUrl", () => {
  it("encodes the bytes with their type, large pictures included", () => {
    expect(dataUrl({ data: Uint8Array.from([0xff, 0xd8, 0xff]), mediaType: "image/jpeg" })).toBe(
      "data:image/jpeg;base64,/9j/",
    );
    const big = new Uint8Array(200_000).fill(65);
    expect(dataUrl({ data: big, mediaType: "image/png" })).toHaveLength("data:image/png;base64,".length + 266_668);
  });
});
