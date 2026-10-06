import type { Speak } from "~/modules/scene";
import type { VoiceDevice } from "./protocol";
import { trackDownload } from "./download";
import { RENDER_CONFIG } from "./env";
import { voiceDevice } from "./support";

// Kokoro-82M through kokoro-js, the same voices as the Node renderer
// (renderer/src/kokoro.ts). By default it runs the full-precision weights
// (about 330 MB) on WebGPU, and without WebGPU the 8-bit ones (about 90 MB)
// on one CPU thread, since a page served without COOP/COEP headers cannot
// share memory between threads (VITE_KOKORO_* change this). transformers.js keeps the weights in Cache Storage
// ("transformers-cache") and kokoro-js its voices ("kokoro-voices").

export interface Voice {
  device: VoiceDevice;
  speak: Speak;
}

export interface DownloadProgress {
  loadedBytes: number;
  totalBytes: number;
  device: VoiceDevice;
}

type Kokoro = import("kokoro-js").KokoroTTS;

async function load(device: VoiceDevice, onDownload: (progress: DownloadProgress) => void): Promise<Kokoro> {
  // Loaded on demand: the ONNX runtime is large and only renders need it.
  const [{ AutoTokenizer, StyleTextToSpeech2Model, env }, { KokoroTTS }] = await Promise.all([
    import("@huggingface/transformers"),
    import("kokoro-js"),
  ]);
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  const wasm = env.backends.onnx.wasm;
  if (wasm) {
    wasm.numThreads = 1;
    // transformers.js points ONNX Runtime at a CDN copy of its WebAssembly.
    // The site ships its own (Vite emits it from onnxruntime-web's bundle),
    // so a render only needs Hugging Face, for the weights.
    wasm.wasmPaths = undefined;
  }

  const download = trackDownload(device, onDownload);
  const progress_callback = download.onEvent;
  // KokoroTTS.from_pretrained, with ONNX Runtime told to keep quiet: on
  // WebGPU it logs, as an error, every op it leaves on the CPU.
  try {
    const [model, tokenizer] = await Promise.all([
      StyleTextToSpeech2Model.from_pretrained(RENDER_CONFIG.kokoroModel, {
        dtype: RENDER_CONFIG.dtype[device],
        device,
        progress_callback,
        session_options: { logSeverityLevel: 3 },
      }),
      AutoTokenizer.from_pretrained(RENDER_CONFIG.kokoroModel, { progress_callback }),
    ]);
    return new KokoroTTS(model as ConstructorParameters<typeof KokoroTTS>[0], tokenizer);
  } catch (error) {
    // A failed load may still have downloads reporting: they no longer count.
    download.stop();
    throw error;
  }
}

let voice: Promise<Voice> | undefined;

// The voice for every render in this worker, loaded once.
export function loadVoice(onDownload: (progress: DownloadProgress) => void): Promise<Voice> {
  voice ??= (async (): Promise<Voice> => {
    let device = await voiceDevice();
    if (!device) throw new Error("this build voices on WebGPU, which this browser does not offer");
    let tts: Kokoro;
    try {
      tts = await load(device, onDownload);
    } catch (error) {
      // A build that asks for WebGPU gets WebGPU or an error.
      if (device === "wasm" || RENDER_CONFIG.device === "webgpu") throw error;
      // Some GPUs refuse the model: fall back to the CPU.
      console.warn("Kokoro could not start on WebGPU, using WebAssembly:", error);
      device = "wasm";
      tts = await load(device, onDownload);
    }
    return {
      device,
      speak: async (text, { voice: name, speed }) => {
        const audio = await tts.generate(text, { voice: name as keyof Kokoro["voices"], speed });
        return { samples: audio.audio, sampleRate: audio.sampling_rate };
      },
    };
  })().catch((error: unknown) => {
    voice = undefined;
    throw new Error(
      `The voice model could not load: ${error instanceof Error ? error.message : String(error)}. Check your connection, then relaunch.`,
    );
  });
  return voice;
}
