import { describe, expect, it } from "vitest";

import { SUPPORTED_EMOTIONS } from "~/modules/script";
import { KOKORO_VOICES, voiceFor } from "./voice";

const ids = Array.from({ length: 40 }, (_, i) => `actor-${i}`);

describe("voiceFor", () => {
  it("keeps the same voice for an actor whatever the emotion", () => {
    const voices = new Set(SUPPORTED_EMOTIONS.map((e) => voiceFor({ id: "actor-1", gender: "female" }, e).voice));
    expect(voices.size).toBe(1);
  });

  it("picks a female voice for women and a male voice for men", () => {
    for (const id of ids) {
      expect(KOKORO_VOICES.female).toContain(voiceFor({ id, gender: "female" }, "neutral").voice);
      expect(KOKORO_VOICES.male).toContain(voiceFor({ id, gender: "male" }, "neutral").voice);
    }
  });

  it("spreads actors over the voices", () => {
    expect(new Set(ids.map((id) => voiceFor({ id, gender: "female" }, "neutral").voice)).size).toBeGreaterThan(3);
  });

  it("draws from both pools for nonbinary or unknown actors", () => {
    const all = [...KOKORO_VOICES.female, ...KOKORO_VOICES.male];
    for (const id of ids) {
      expect(all).toContain(voiceFor({ id, gender: "nonbinary" }, "neutral").voice);
      expect(all).toContain(voiceFor({ id }, "neutral").voice);
    }
  });

  it("speeds up excitement and slows down disappointment", () => {
    const speed = (emotion: (typeof SUPPORTED_EMOTIONS)[number]) => voiceFor({ id: "a", gender: "male" }, emotion).speed;
    expect(speed("neutral")).toBe(1);
    expect(speed("excited")).toBeGreaterThan(speed("happy"));
    expect(speed("happy")).toBeGreaterThan(1);
    expect(speed("calm")).toBeLessThan(1);
    expect(speed("disappointed")).toBeLessThan(speed("calm"));
    for (const e of SUPPORTED_EMOTIONS) {
      expect(speed(e)).toBeGreaterThanOrEqual(0.8);
      expect(speed(e)).toBeLessThanOrEqual(1.2);
    }
  });

  it("follows the tempo in the voice profile", () => {
    const base = voiceFor({ id: "a", gender: "female" }, "neutral").speed;
    expect(voiceFor({ id: "a", gender: "female", voiceProfile: "bright and fast, upbeat" }, "neutral").speed).toBeGreaterThan(base);
    expect(voiceFor({ id: "a", gender: "female", voiceProfile: "soft-spoken and intimate" }, "neutral").speed).toBeLessThan(base);
    expect(voiceFor({ id: "a", gender: "female", voiceProfile: "warm and enthusiastic, mid-tempo" }, "neutral").speed).toBe(base);
  });
});
