import { describe, expect, it } from "vitest";

import kling from "./fal-fixtures/fal-kling-v3-pro.json";
import minimax from "./fal-fixtures/fal-minimax-h3-max.json";
import veo from "./fal-fixtures/fal-veo31-fast.json";
import wan from "./fal-fixtures/fal-wan-3-prime.json";
import { describeFalModel, falRequestBody, isFalEndpoint, parseFalInput } from "./fal-schema";

// The fixtures are the Input schemas fal.ai published for these endpoints.
const REQ = { prompt: "Dawn.", aspectRatio: "9:16", durationS: 6, resolution: "720p", audio: false };

const ok = (endpoint: string, schema: unknown) => {
  const described = describeFalModel(endpoint, schema);
  if (!described.ok) throw new Error(described.reason);
  return described.model;
};

describe("describeFalModel", () => {
  it("reads a string-enum length, the formats and sound (Kling 3.0 Pro)", () => {
    const m = ok("fal-ai/kling-video/v3/pro/text-to-video", kling);
    expect(m.capabilities).toMatchObject({
      aspectRatios: ["16:9", "9:16", "1:1"],
      durationsS: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      audio: "optional",
    });
    expect(falRequestBody(m.input, REQ)).toEqual({
      prompt: "Dawn.",
      duration: "6",
      aspect_ratio: "9:16",
      generate_audio: false,
    });
  });

  it('sends lengths as "8s" where the model writes them so (Veo 3.1 Fast)', () => {
    const m = ok("fal-ai/veo3.1/fast", veo);
    expect(m.capabilities.durationsS).toEqual([4, 6, 8]);
    expect(m.capabilities.resolutions).toEqual(["720p", "1080p", "4k"]);
    expect(falRequestBody(m.input, { ...REQ, durationS: 8 })).toMatchObject({ duration: "8s", resolution: "720p" });
  });

  it("turns a bounded number into lengths and fills the settings it requires (MiniMax H3 Max)", () => {
    const m = ok("minimax/h3-max/text-to-video", minimax);
    expect(m.capabilities.durationsS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(m.capabilities.resolutions).toContain("768P");
    expect(m.capabilities.audio).toBe("none");
    const body = falRequestBody(m.input, { ...REQ, resolution: "768P" });
    expect(body).toMatchObject({ duration: 6, resolution: "768P" });
    expect(body).toHaveProperty("prompt_expansion_mode");
    expect(body).not.toHaveProperty("generate_audio");
  });

  it("reads a nullable length and leaves out the formats that are not ratios (Wan 3.0 Prime)", () => {
    const m = ok("alibaba/wan-3.0-prime/text-to-video", wan);
    expect(m.capabilities.durationsS[0]).toBe(2);
    expect(m.capabilities.aspectRatios).not.toContain("adaptive");
    expect(m.capabilities.aspectRatios).toContain("9:16");
  });

  it("refuses an endpoint without a prompt, or one needing a setting it cannot fill", () => {
    expect(describeFalModel("a/b", { components: { schemas: { XInput: { properties: { image_url: {} } } } } })).toEqual(
      {
        ok: false,
        reason: "This model does not render from a text prompt.",
      },
    );
    expect(
      describeFalModel("a/b", {
        components: {
          schemas: { XInput: { properties: { prompt: {}, image_url: {} }, required: ["prompt", "image_url"] } },
        },
      }),
    ).toEqual({ ok: false, reason: 'This model needs a "image_url" setting Troupe cannot choose.' });
  });
});

describe("stored fal connections", () => {
  it("reads back what was stored and refuses anything else", () => {
    const m = ok("fal-ai/veo3.1/fast", veo);
    expect(parseFalInput(JSON.parse(JSON.stringify(m.input)))).toEqual(m.input);
    expect(parseFalInput({ endpoint: "https://evil.example/x" })).toBeNull();
    expect(parseFalInput(null)).toBeNull();
  });

  it("knows a fal endpoint id", () => {
    expect(isFalEndpoint("fal-ai/kling-video/v3/pro/text-to-video")).toBe(true);
    expect(isFalEndpoint("kling")).toBe(false);
    expect(isFalEndpoint("a/../b")).toBe(false);
    expect(isFalEndpoint("https://queue.fal.run/a/b")).toBe(false);
  });
});
