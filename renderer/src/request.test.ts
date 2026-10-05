import { describe, expect, it } from "vitest";

import { compilePrompt } from "~/modules/generation/server/adapter";
import { buildScene } from "../../src/modules/scene";
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

  it("refuses a portrait path that could leave the portraits folder", () => {
    for (const path of ["../secrets/key.webp", "actors/../../etc/passwd", "actors/lea-01/v1/../../../x.webp", "/etc/passwd", "actors\\..\\x.webp"]) {
      expect(() => parseJobBody({ ...base, script: { ...script, actor: { ...script.actor, portraits: { front: path } } } }), path).toThrow(/portraits\.front/);
    }
  });

  it("drops portrait entries it cannot use, says so, and keeps the job", () => {
    const log: string[] = [];
    const portraits = { front: "actors/lea-01/v1/front.webp", happy: "actors/lea-01/v1/happy.svg", calm: 42, excited: "cast/lea.webp" };
    const parsed = parseJobBody({ ...base, script: { ...script, actor: { ...script.actor, portraits } } }, (m) => log.push(m));
    expect(parsed.actor.portraits).toEqual({ front: "actors/lea-01/v1/front.webp" });
    expect(log).toHaveLength(3);
    expect(log.join("\n")).toMatch(/happy/);
    // Not an object at all: no portraits, the initials.
    const none = parseJobBody({ ...base, script: { ...script, actor: { ...script.actor, portraits: "front.webp" } } }, (m) => log.push(m));
    expect(none.actor.portraits).toBeUndefined();
    expect(log).toHaveLength(4);
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
    expect(parsed.actor).toMatchObject({ name: "Narrator", voiceProfile: "calm and confident, low register" });
    // The same prompt voice keeps the same colors and voice.
    expect(parseJobBody({ ...base, prompt }).actor.id).toBe(parsed.actor.id);
  });

  it("reads a prompt without dialogue as a single line", () => {
    const parsed = parseJobBody({ ...base, prompt: "  A presenter says hello.  " });
    expect(parsed.lines).toEqual([{ role: "hook", text: "A presenter says hello.", emotion: "neutral" }]);
  });

  // The estimated length of the lines, as buildScene times a silent job.
  const lengthS = (lines: ReturnType<typeof parseJobBody>["lines"]) => buildScene({ width: 720, height: 1280, actor: { id: "a", name: "A" }, lines }).durationS;

  it("cuts the prompt's dialogue to about one and a half times duration_s, and says so", () => {
    const said = "Fresh beans every week and a grinder that finally keeps up with my mornings.";
    const prompt = compilePrompt({ lines: Array.from({ length: 40 }, () => ({ role: "body" as const, text: said, emotion: "neutral" as const })), voiceProfile: "calm", language: "en" });
    const log: string[] = [];
    const parsed = parseJobBody({ ...base, prompt, duration_s: 6 }, (m) => log.push(m));
    expect(lengthS(parsed.lines)).toBeLessThanOrEqual(6 * 1.5);
    expect(lengthS(parsed.lines)).toBeGreaterThan(6);
    expect(parsed.lines[0]!.text).toBe(said);
    expect(log.join("\n")).toMatch(/duration_s/);

    // A prompt without dialogue is one line: cut the same way.
    const plain = parseJobBody({ ...base, prompt: said.repeat(50), duration_s: 4 }, (m) => log.push(m));
    expect(plain.lines).toHaveLength(1);
    expect(lengthS(plain.lines)).toBeLessThanOrEqual(4 * 1.5);
    expect(plain.lines[0]!.text.length).toBeGreaterThan(0);

    // A dialogue that fits is kept whole, without a word in the log.
    const quiet: string[] = [];
    const short = compilePrompt({ lines: script.lines.map((l) => ({ ...l, role: l.role as "hook", emotion: l.emotion as "calm" })), voiceProfile: "calm", language: "en" });
    expect(parseJobBody({ ...base, prompt: short }, (m) => quiet.push(m)).lines).toEqual(script.lines);
    expect(quiet).toEqual([]);
  });

  it("warns that lines in another language are read with English voices", () => {
    const log: string[] = [];
    parseJobBody({ ...base, script }, (m) => log.push(m));
    expect(log).toEqual([]);
    parseJobBody({ ...base, script: { ...script, language: "fr" } }, (m) => log.push(m));
    expect(log).toEqual([expect.stringMatching(/"fr".*English/)]);
    parseJobBody({ ...base, prompt: compilePrompt({ lines: [{ role: "hook", text: "Bonjour.", emotion: "calm" }], voiceProfile: "calm", language: "de" }) }, (m) => log.push(m));
    expect(log.at(-1)).toMatch(/"de"/);
  });

  it("refuses bodies the contract does not allow", () => {
    expect(() => parseJobBody(null)).toThrow(BadRequest);
    expect(() => parseJobBody({ prompt: "x" })).toThrow(/prompt, width, height and duration_s are required/);
    expect(() => parseJobBody({ ...base, width: 721 })).toThrow(/even/);
    expect(() => parseJobBody({ ...base, duration_s: "six" })).toThrow(/duration_s/);
    expect(() => parseJobBody({ ...base, duration_s: -4 })).toThrow(/duration_s/);
    expect(() => parseJobBody({ ...base, width: 8000 })).toThrow(/between/);
    expect(() => parseJobBody({ ...base, fps: 1000 })).toThrow(/fps/);
    expect(() => parseJobBody({ ...base, script: { ...script, lines: [] } })).toThrow(/at least one line/);
    expect(() => parseJobBody({ ...base, script: { ...script, lines: [{ role: "intro", text: "Hi", emotion: "calm" }] } })).toThrow(/role/);
    expect(() => parseJobBody({ ...base, script: { ...script, lines: [{ role: "hook", text: "Hi", emotion: "furious" }] } })).toThrow(/emotion/);
    expect(() => parseJobBody({ ...base, script: { ...script, lines: [{ role: "hook", text: " ", emotion: "calm" }] } })).toThrow(/text/);
    expect(() => parseJobBody({ ...base, script: { ...script, actor: { name: "Léa" } } })).toThrow(/actor/);
  });
});
