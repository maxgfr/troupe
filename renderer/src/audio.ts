import type { Scene, VoiceChoice } from "../../src/modules/scene";

// Mono PCM, samples in [-1, 1].
export interface Speech {
  samples: Float32Array;
  sampleRate: number;
}

// Text to speech. Kokoro in production (kokoro.ts); tests pass a tone.
export type Speak = (text: string, voice: VoiceChoice) => Promise<Speech>;

// One track as long as the scene, each line starting with its cue.
export function assembleTrack(speeches: Speech[], scene: Scene): Speech {
  const sampleRate = speeches[0]?.sampleRate ?? 24000;
  if (speeches.some((s) => s.sampleRate !== sampleRate)) throw new Error("Every line must be voiced at the same sample rate.");
  const samples = new Float32Array(Math.round(scene.durationS * sampleRate));
  for (const [i, speech] of speeches.entries()) {
    const cue = scene.cues[i];
    if (!cue) break;
    const offset = Math.round(cue.startS * sampleRate);
    samples.set(speech.samples.subarray(0, Math.max(0, samples.length - offset)), offset);
  }
  return { samples, sampleRate };
}

// 16-bit PCM WAV, for ffmpeg.
export function wavBytes({ samples, sampleRate }: Speech): Buffer {
  const data = samples.length * 2;
  const wav = Buffer.alloc(44 + data);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + data, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(data, 40);
  for (const [i, s] of samples.entries()) wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), 44 + 2 * i);
  return wav;
}
