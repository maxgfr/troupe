import type { Speak } from "../../src/modules/scene";

// Kokoro-82M through kokoro-js, on the CPU. The weights (about 90 MB at q8,
// plus 0.5 MB per voice) download from Hugging Face on first use into
// cacheDir and are reused afterwards.
export const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

const DTYPES = ["fp32", "fp16", "q8", "q4", "q4f16"] as const;
export type KokoroDtype = (typeof DTYPES)[number];

// KOKORO_DTYPE: the weights to run, q8 when unset.
export function parseKokoroDtype(value: string | undefined): KokoroDtype {
  const dtype = value?.trim() || "q8";
  const known = DTYPES.find((d) => d === dtype);
  if (!known) throw new Error(`KOKORO_DTYPE must be one of ${DTYPES.join(", ")} (got "${dtype}").`);
  return known;
}

export function kokoroVoice(options: { cacheDir: string; dtype?: KokoroDtype; log?: (message: string) => void }): { speak: Speak; load: () => Promise<void> } {
  let model: Promise<import("kokoro-js").KokoroTTS> | undefined;

  function load() {
    model ??= (async () => {
      // Loaded on demand so tests and imports never pull the ONNX runtime.
      const { env } = await import("@huggingface/transformers");
      const { KokoroTTS } = await import("kokoro-js");
      env.cacheDir = options.cacheDir;
      const started = Date.now();
      const tts = await KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype: options.dtype ?? "q8", device: "cpu" });
      options.log?.(`Kokoro voices ready (${options.dtype ?? "q8"}) in ${((Date.now() - started) / 1000).toFixed(1)} s`);
      return tts;
    })().catch((error: Error) => {
      model = undefined;
      throw new Error(`Could not load the Kokoro voices: ${error.message}`);
    });
    return model;
  }

  return {
    load: async () => {
      await load();
    },
    speak: async (text, { voice, speed }) => {
      const tts = await load();
      const audio = await tts.generate(text, { voice: voice as keyof typeof tts.voices, speed });
      return { samples: audio.audio, sampleRate: audio.sampling_rate };
    },
  };
}
