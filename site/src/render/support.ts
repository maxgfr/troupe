import { RENDER_CONFIG } from "./env";
import type { VoiceDevice } from "./protocol";

// What this browser brings to a render. WebCodecs, an OffscreenCanvas, Web
// Locks and IndexedDB are required; WebGPU is not, but without it Kokoro
// voices the lines on one CPU thread, which is several times slower.

export interface RenderSupport {
  ok: boolean;
  // Where the voices will run.
  device: VoiceDevice;
  // One or two sentences, shown in Settings and before a launch.
  detail: string;
}

const NO_RENDER = "This browser cannot render video";
const USE = "Open the demo in a recent Chrome or Edge.";

async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

// Where the voices run in this browser (VITE_KOKORO_DEVICE), or null when
// the build asks for WebGPU and the browser has none. The worker asks too.
export async function voiceDevice(): Promise<VoiceDevice | null> {
  if (RENDER_CONFIG.device === "wasm") return "wasm";
  const gpu = await hasWebGpu();
  if (RENDER_CONFIG.device === "webgpu") return gpu ? "webgpu" : null;
  return gpu ? "webgpu" : "wasm";
}

async function detect(): Promise<RenderSupport> {
  const missing = [
    typeof Worker === "undefined" && "web workers",
    typeof OffscreenCanvas === "undefined" && "OffscreenCanvas",
    !("locks" in navigator) && "Web Locks",
    typeof indexedDB === "undefined" && "IndexedDB",
  ].filter(Boolean);
  if (missing.length > 0) return { ok: false, device: "wasm", detail: `${NO_RENDER}: it lacks ${missing.join(", ")}. ${USE}` };

  const { pickCodecs } = await import("./encode");
  // Each format's frame, since encoders have size limits of their own.
  for (const [width, height] of [[720, 1280], [1280, 720], [720, 720]] as const) {
    const codecs = await pickCodecs(width, height);
    if ("problem" in codecs) return { ok: false, device: "wasm", detail: `${NO_RENDER}: ${codecs.problem}. ${USE}` };
  }
  const device = await voiceDevice();
  if (!device) return { ok: false, device: "wasm", detail: `${NO_RENDER}: this build voices the script on WebGPU, which it lacks. ${USE}` };
  return {
    ok: true,
    device,
    detail:
      device === "webgpu"
        ? "Renders run in this tab: voices on the GPU (WebGPU), video encoded with WebCodecs."
        : "Renders run in this tab, with the voices made on the CPU, several times slower than on a GPU.",
  };
}

let support: Promise<RenderSupport> | undefined;

export function renderSupport(): Promise<RenderSupport> {
  support ??= detect().catch((error: unknown) => ({ ok: false, device: "wasm" as const, detail: `${NO_RENDER}: ${error instanceof Error ? error.message : String(error)}` }));
  return support;
}
