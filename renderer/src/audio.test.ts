import { describe, expect, it } from "vitest";

import { buildScene } from "../../src/modules/scene";
import { assembleTrack, wavBytes } from "./audio";

const rate = 1000;
const speech = (seconds: number, value: number) => ({ samples: new Float32Array(Math.round(seconds * rate)).fill(value), sampleRate: rate });

describe("assembleTrack", () => {
  const speeches = [speech(1, 0.5), speech(0.5, -0.25)];
  const scene = buildScene({ width: 720, height: 1280, actor: { id: "a", name: "A" }, lines: [
    { role: "hook", text: "One two", emotion: "neutral" },
    { role: "cta", text: "Three", emotion: "neutral" },
  ], speechS: [1, 0.5] });
  const track = assembleTrack(speeches, scene);

  it("lasts as long as the scene", () => {
    expect(track.sampleRate).toBe(rate);
    expect(track.samples.length).toBe(Math.round(scene.durationS * rate));
  });

  it("starts each line when its cue starts, with silence around", () => {
    const at = (s: number) => track.samples[Math.floor(s * rate)];
    const [first, second] = scene.cues;
    expect(at(first!.startS / 2)).toBe(0);
    expect(at(first!.startS + 0.01)).toBe(0.5);
    expect(at((first!.endS + second!.startS) / 2)).toBe(0);
    expect(at(second!.startS + 0.01)).toBe(-0.25);
    expect(at(scene.durationS - 0.01)).toBe(0);
  });

  it("refuses voices at different sample rates", () => {
    expect(() => assembleTrack([speech(1, 0), { samples: new Float32Array(10), sampleRate: 2000 }], scene)).toThrow(/sample rate/);
  });
});

describe("wavBytes", () => {
  it("writes 16-bit mono PCM with a RIFF header", () => {
    const wav = wavBytes({ samples: new Float32Array([0, 1, -1, 2]), sampleRate: 24000 });
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(8);
    expect([0, 1, 2, 3].map((i) => wav.readInt16LE(44 + 2 * i))).toEqual([0, 32767, -32767, 32767]);
  });
});
