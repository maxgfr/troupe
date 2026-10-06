import type { Speech } from "../../src/modules/scene";

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
  for (const [i, s] of samples.entries())
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), 44 + 2 * i);
  return wav;
}
