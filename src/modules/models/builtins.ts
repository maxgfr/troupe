import type { ModelCapabilities } from "~/modules/generation";

export type CredentialId = "google" | "fal";

export interface BuiltinModel {
  key: string;
  family: "veo" | "fal";
  label: string;
  vendor: string;
  // Which provider account pays for it.
  credential: CredentialId;
  // Upstream identifier: Gemini model id or fal endpoint path.
  modelId: string;
  capabilities: ModelCapabilities;
  defaults: { resolution: string; durationS: number; audio: boolean };
  // Unverified prices stay null rather than guessed; users can set their own.
  pricePerSecondUsd: number | null;
  timeoutS: number;
  // fal endpoints differ on whether they take a resolution parameter.
  sendsResolution?: boolean;
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

// Capabilities checked against the providers' API references on 2026-10-04:
// https://ai.google.dev/gemini-api/docs/veo,
// https://fal.ai/models/fal-ai/kling-video/v3/standard/text-to-video/api,
// https://fal.ai/models/fal-ai/bytedance/seedance/v1.5/pro/text-to-video/api.
// dialogueLanguages lists what has been tried, not every language a model may speak.
export const BUILTIN_MODELS: readonly BuiltinModel[] = [
  {
    key: "veo-3.1-fast",
    family: "veo",
    label: "Veo 3.1 Fast",
    vendor: "Google",
    credential: "google",
    modelId: "veo-3.1-fast-generate-preview",
    // 1080p exists upstream but only for 8 s clips; 720p keeps every duration valid.
    capabilities: { aspectRatios: ["9:16", "16:9"], resolutions: ["720p"], durationsS: [4, 6, 8], audio: "always", dialogueLanguages: ["en"] },
    defaults: { resolution: "720p", durationS: 8, audio: true },
    pricePerSecondUsd: null,
    timeoutS: 1800,
  },
  {
    key: "kling-3.0",
    family: "fal",
    label: "Kling 3.0",
    vendor: "Kling via fal.ai",
    credential: "fal",
    modelId: "fal-ai/kling-video/v3/standard/text-to-video",
    // The standard tier takes no resolution parameter; 720p is its nominal output.
    capabilities: { aspectRatios: ["9:16", "16:9", "1:1"], resolutions: ["720p"], durationsS: range(3, 15), audio: "optional", dialogueLanguages: ["en", "zh"] },
    defaults: { resolution: "720p", durationS: 8, audio: true },
    pricePerSecondUsd: null,
    timeoutS: 1800,
    sendsResolution: false,
  },
  {
    key: "seedance-1.5-pro",
    family: "fal",
    label: "Seedance 1.5 Pro",
    vendor: "ByteDance via fal.ai",
    credential: "fal",
    modelId: "fal-ai/bytedance/seedance/v1.5/pro/text-to-video",
    capabilities: { aspectRatios: ["9:16", "16:9", "1:1"], resolutions: ["480p", "720p", "1080p"], durationsS: range(4, 12), audio: "optional", dialogueLanguages: ["en", "zh"] },
    defaults: { resolution: "720p", durationS: 8, audio: true },
    pricePerSecondUsd: null,
    timeoutS: 1800,
    sendsResolution: true,
  },
];

// Legacy `provider` values on rows written before the model catalog.
export const LEGACY_PROVIDER_MODEL_KEYS: Record<string, string> = {
  veo: "veo-3.1-fast",
  kling: "kling-3.0",
  seedance: "seedance-1.5-pro",
};
