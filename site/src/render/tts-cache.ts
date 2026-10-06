import { KOKORO_WEIGHTS } from "./config";
import { RENDER_CONFIG } from "./env";
import type { VoiceDevice } from "./protocol";

// Which Kokoro weights a device runs and whether this browser already has
// them: the page says so before a launch, the worker loads them.

export const weightsFor = (device: VoiceDevice) => KOKORO_WEIGHTS[RENDER_CONFIG.dtype[device]];

// Where transformers.js keeps what it downloads (env.useBrowserCache).
const CACHE = "transformers-cache";

export async function voiceModelCached(device: VoiceDevice): Promise<boolean> {
  try {
    const cache = await caches.open(CACHE);
    return Boolean(
      await cache.match(`https://huggingface.co/${RENDER_CONFIG.kokoroModel}/resolve/main/${weightsFor(device).file}`),
    );
  } catch {
    return false;
  }
}
