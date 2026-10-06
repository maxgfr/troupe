import type { AudioCodec } from "mediabunny";

// Audio encoders put silence before the sound they encode (AAC's "priming":
// 2112 samples, 44 ms at 48 kHz, with Chrome's encoder on macOS), and
// WebCodecs does not say so: the first chunk is stamped 0. Left in, the
// voice plays that much behind the picture and the audio track runs longer
// than the video. encode.ts stamps the audio that much early instead, so the
// MP4's edit list trims the silence.
//
// The delay depends on the encoder, so it is measured once per codec: encode
// a short pulse, decode it, and see where the pulse came back.

const RATE = 48_000;
const PULSE_AT = 4800;
const PULSE_LENGTH = 48;
export const PROBE = { rate: RATE, length: 9600 } as const;
// Beyond this (100 ms) an answer is more likely a broken round trip than a
// delay: encoders prime a few tens of milliseconds (Chrome's AAC 44 ms), and
// a wrong but plausible shift would put the voice off the picture.
const MAX_DELAY = RATE / 10;

export function probeSignal(): Float32Array<ArrayBuffer> {
  const signal = new Float32Array(PROBE.length);
  signal.fill(0.8, PULSE_AT, PULSE_AT + PULSE_LENGTH);
  return signal;
}

// Where the pulse's energy sits, against where it was sent: the encoder's
// delay in samples, or 0 when the pulse is not found.
export function delayFromProbe(decoded: Float32Array): number {
  let energy = 0;
  let moment = 0;
  for (let i = 0; i < decoded.length; i++) {
    const e = decoded[i]! * decoded[i]!;
    energy += e;
    moment += i * e;
  }
  if (energy < 1e-3) return 0;
  const delay = Math.round(moment / energy - (PULSE_AT + (PULSE_LENGTH - 1) / 2));
  return delay > 0 && delay < MAX_DELAY ? delay : 0;
}

const WEBCODECS: Record<string, string> = { aac: "mp4a.40.2", opus: "opus" };

async function measure(codec: AudioCodec, bitrate: number): Promise<number> {
  const name = WEBCODECS[codec];
  if (!name) return 0;
  const chunks: EncodedAudioChunk[] = [];
  let config: AudioDecoderConfig | undefined;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      chunks.push(chunk);
      config ??= meta?.decoderConfig;
    },
    error: () => {},
  });
  encoder.configure({ codec: name, sampleRate: RATE, numberOfChannels: 1, bitrate });
  encoder.encode(
    new AudioData({
      format: "f32",
      sampleRate: RATE,
      numberOfFrames: PROBE.length,
      numberOfChannels: 1,
      timestamp: 0,
      data: probeSignal(),
    }),
  );
  await encoder.flush();
  encoder.close();
  if (!config) return 0;

  const parts: Float32Array[] = [];
  const decoder = new AudioDecoder({
    output: (data) => {
      const part = new Float32Array(data.numberOfFrames);
      data.copyTo(part, { planeIndex: 0, format: "f32-planar" });
      parts.push(part);
      data.close();
    },
    error: () => {},
  });
  decoder.configure(config);
  for (const chunk of chunks) decoder.decode(chunk);
  await decoder.flush();
  decoder.close();
  const decoded = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    decoded.set(part, offset);
    offset += part.length;
  }
  return delayFromProbe(decoded);
}

const measured = new Map<string, Promise<number>>();

// The encoder's delay in seconds, measured once per codec and bitrate. A
// failed measurement means no correction: the video still plays.
export function encoderDelayS(codec: AudioCodec, bitrate: number): Promise<number> {
  const key = `${codec}@${bitrate}`;
  let delay = measured.get(key);
  if (!delay) {
    delay = measure(codec, bitrate).then(
      (samples) => samples / RATE,
      () => 0,
    );
    measured.set(key, delay);
  }
  return delay;
}
