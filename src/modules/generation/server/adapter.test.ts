import { describe, expect, it } from "vitest";

import { AdapterError, validateRequest, type ModelCapabilities } from "./adapter";

const caps: ModelCapabilities = {
  aspectRatios: ["9:16", "16:9"],
  resolutions: ["720p"],
  durationsS: [4, 6, 8],
  audio: "always",
  dialogueLanguages: ["en"],
};
const ok = { prompt: "p", aspectRatio: "9:16", resolution: "720p", durationS: 8, audio: true };

function codeOf(fn: () => void) {
  try {
    fn();
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(AdapterError);
    return (error as AdapterError).code;
  }
}

describe("validateRequest", () => {
  it("accepts a request inside the declared capabilities", () => {
    expect(codeOf(() => validateRequest(caps, ok))).toBeNull();
  });

  it("names the first unsupported dimension", () => {
    expect(codeOf(() => validateRequest(caps, { ...ok, aspectRatio: "1:1" }))).toBe("UNSUPPORTED_ASPECT_RATIO");
    expect(codeOf(() => validateRequest(caps, { ...ok, resolution: "1080p" }))).toBe("UNSUPPORTED_RESOLUTION");
    expect(codeOf(() => validateRequest(caps, { ...ok, durationS: 5 }))).toBe("UNSUPPORTED_DURATION");
  });

  it("checks audio against the model's audio support", () => {
    expect(codeOf(() => validateRequest(caps, { ...ok, audio: false }))).toBe("AUDIO_ALWAYS_ON");
    expect(codeOf(() => validateRequest({ ...caps, audio: "none" }, { ...ok, audio: true }))).toBe("AUDIO_UNSUPPORTED");
    expect(codeOf(() => validateRequest({ ...caps, audio: "optional" }, { ...ok, audio: false }))).toBeNull();
  });

  it("explains the problem in a readable sentence", () => {
    try {
      validateRequest(caps, { ...ok, durationS: 5 });
    } catch (error) {
      expect((error as AdapterError).detail).toMatch(/4, 6 or 8 seconds/);
    }
  });
});
