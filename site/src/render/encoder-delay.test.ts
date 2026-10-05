import { describe, expect, it } from "vitest";

import { PROBE, delayFromProbe, probeSignal } from "./encoder-delay";

// What an encoder + decoder round trip gives back for the probe: the same
// pulse, `delay` samples later, smeared a little as lossy codecs do.
function roundTrip(delay: number, smear = 0): Float32Array {
  const input = probeSignal();
  const out = new Float32Array(input.length + delay + 2048);
  for (let i = 0; i < input.length; i++) {
    if (!input[i]) continue;
    for (let k = -smear; k <= smear; k++) out[i + delay + k]! += input[i]! / (2 * smear + 1);
  }
  return out;
}

describe("encoder delay", () => {
  it("finds the silence an encoder puts before the sound, in samples", () => {
    // Chrome's AAC encoder on macOS primes 2112 samples (measured).
    expect(delayFromProbe(roundTrip(2112))).toBe(2112);
    expect(delayFromProbe(roundTrip(1024, 40))).toBe(1024);
    expect(delayFromProbe(roundTrip(0))).toBe(0);
  });

  it("reports no delay when the probe cannot be found or makes no sense", () => {
    expect(delayFromProbe(new Float32Array(PROBE.length))).toBe(0);
    // An encoder never moves sound earlier.
    expect(delayFromProbe(probeSignal().subarray(10))).toBe(0);
    // Encoders delay by a few tens of milliseconds: past 100 ms the round
    // trip is more likely broken, and a wrong but plausible shift would put
    // the voice off the picture.
    expect(delayFromProbe(roundTrip(3840))).toBe(3840);
    expect(delayFromProbe(roundTrip(6000))).toBe(0);
  });
});
