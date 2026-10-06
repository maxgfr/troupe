import type { Scene } from "./build";
import type { VoiceChoice } from "./voice";

// Mono PCM, samples in [-1, 1].
export interface Speech {
  samples: Float32Array;
  sampleRate: number;
}

// Text to speech: Kokoro in both renderers; tests pass a tone.
export type Speak = (text: string, voice: VoiceChoice) => Promise<Speech>;

// One track as long as the scene, each line starting with its cue.
export function assembleTrack(speeches: Speech[], scene: Scene): Speech {
  const sampleRate = speeches[0]?.sampleRate ?? 24000;
  if (speeches.some((s) => s.sampleRate !== sampleRate))
    throw new Error("Every line must be voiced at the same sample rate.");
  const samples = new Float32Array(Math.round(scene.durationS * sampleRate));
  for (const [i, speech] of speeches.entries()) {
    const cue = scene.cues[i];
    if (!cue) break;
    const offset = Math.round(cue.startS * sampleRate);
    samples.set(speech.samples.subarray(0, Math.max(0, samples.length - offset)), offset);
  }
  return { samples, sampleRate };
}
