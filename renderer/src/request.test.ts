import { describe, expect, it } from "vitest";

import { compilePrompt } from "~/modules/generation/server/adapter";
import { BadRequest, parseJobBody } from "./request";

const base = { prompt: "UGC-style ad", aspect_ratio: "9:16", resolution: "720p", width: 720, height: 1280, duration_s: 6, audio: true };
const script = {
  language: "en",
  actor: { id: "6f1c0e8a", name: "Léa", gender: "female", age_range: "18-24", voice_profile: "warm and enthusiastic, mid-tempo" },
  lines: [
    { role: "hook", text: "This ended my search for good coffee.", emotion: "excited" },
    { role: "cta", text: "Grab yours today.", emotion: "calm" },
  ],
};

describe("parseJobBody", () => {
  it("reads the script Troupe sends with the job", () => {
    expect(parseJobBody({ ...base, fps: 30, script })).toEqual({
      width: 720,
      height: 1280,
      fps: 30,
      audio: true,
      language: "en",
      actor: { id: "6f1c0e8a", name: "Léa", gender: "female", ageRange: "18-24", voiceProfile: "warm and enthusiastic, mid-tempo" },
      lines: script.lines,
    });
  });

  it("reads the actor's portraits, keyed by shot", () => {
    const portraits = { front: "actors/lea-01/v1/front.webp", happy: "actors/lea-01/v1/happy.webp", "profile-left": "actors/lea-01/v1/profile-left.webp" };
    expect(parseJobBody({ ...base, script: { ...script, actor: { ...script.actor, portraits } } }).actor.portraits).toEqual(portraits);
    // Not sent: none.
    expect(parseJobBody({ ...base, script }).actor.portraits).toBeUndefined();
  });

  it("refuses a portrait path outside the actors' folders", () => {
    for (const path of ["../secrets/key.webp", "actors/../../etc/passwd", "/etc/passwd", "actors/lea-01/v1/front.svg", 42]) {
      expect(() => parseJobBody({ ...base, script: { ...script, actor: { ...script.actor, portraits: { front: path } } } }), String(path)).toThrow(/portraits\.front/);
    }
    expect(() => parseJobBody({ ...base, script: { ...script, actor: { ...script.actor, portraits: "front.webp" } } })).toThrow(/portraits/);
  });

  it("defaults to 24 fps", () => {
    expect(parseJobBody({ ...base, script }).fps).toBe(24);
  });

  it("falls back to the dialogue in the prompt when there is no script", () => {
    const prompt = compilePrompt({
      lines: [
        { role: "hook", text: "This ended my search for good coffee.", emotion: "excited" },
        { role: "body", text: "Fresh beans, every week.", emotion: "happy" },
        { role: "cta", text: "Grab yours today.", emotion: "calm" },
      ],
      voiceProfile: "calm and confident, low register",
      language: "en",
    });
    const parsed = parseJobBody({ ...base, prompt });
    expect(parsed.lines).toEqual([
      { role: "hook", text: "This ended my search for good coffee.", emotion: "excited" },
      { role: "body", text: "Fresh beans, every week.", emotion: "happy" },
      { role: "cta", text: "Grab yours today.", emotion: "calm" },
    ]);
    expect(parsed.language).toBe("en");
    expect(parsed.actor).toMatchObject({ name: "Narrator", voiceProfile: "calm and confident, low register" });
    // The same prompt voice keeps the same colors and voice.
    expect(parseJobBody({ ...base, prompt }).actor.id).toBe(parsed.actor.id);
  });

  it("reads a prompt without dialogue as a single line", () => {
    const parsed = parseJobBody({ ...base, prompt: "  A presenter says hello.  " });
    expect(parsed.lines).toEqual([{ role: "hook", text: "A presenter says hello.", emotion: "neutral" }]);
    expect(parsed.language).toBe("en");
  });

  it("refuses bodies the contract does not allow", () => {
    expect(() => parseJobBody(null)).toThrow(BadRequest);
    expect(() => parseJobBody({ prompt: "x" })).toThrow(/prompt, width, height and duration_s are required/);
    expect(() => parseJobBody({ ...base, width: 721 })).toThrow(/even/);
    expect(() => parseJobBody({ ...base, width: 8000 })).toThrow(/between/);
    expect(() => parseJobBody({ ...base, fps: 1000 })).toThrow(/fps/);
    expect(() => parseJobBody({ ...base, script: { ...script, lines: [] } })).toThrow(/at least one line/);
    expect(() => parseJobBody({ ...base, script: { ...script, lines: [{ role: "intro", text: "Hi", emotion: "calm" }] } })).toThrow(/role/);
    expect(() => parseJobBody({ ...base, script: { ...script, lines: [{ role: "hook", text: "Hi", emotion: "furious" }] } })).toThrow(/emotion/);
    expect(() => parseJobBody({ ...base, script: { ...script, lines: [{ role: "hook", text: " ", emotion: "calm" }] } })).toThrow(/text/);
    expect(() => parseJobBody({ ...base, script: { ...script, actor: { name: "Léa" } } })).toThrow(/actor/);
  });
});
