import { describe, expect, it } from "vitest";

import { wavBytes } from "./audio";

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
