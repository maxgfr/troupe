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
  // The longest prompt the endpoint takes, in characters.
  promptMaxChars?: number;
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

// Capabilities and prices checked against the providers' API references and
// pricing pages on 2026-10-05: https://ai.google.dev/gemini-api/docs/veo,
// https://ai.google.dev/gemini-api/docs/pricing, the fal OpenAPI schemas
// (https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=...) and model
// pages. A price is per second at the model's default settings (720p, with
// audio); other settings cost more or less, and Settings can override it.
// dialogueLanguages lists what has been tried, not every language a model may speak.
export const BUILTIN_MODELS: readonly BuiltinModel[] = [
  {
    key: "veo-3.1-fast",
    family: "veo",
    label: "Veo 3.1 Fast",
    vendor: "Google",
    credential: "google",
    modelId: "veo-3.1-fast-generate-preview",
    // 1080p and 4k exist upstream but only for 8 s clips; 720p keeps every duration valid.
    capabilities: {
      aspectRatios: ["9:16", "16:9"],
      resolutions: ["720p"],
      durationsS: [4, 6, 8],
      audio: "always",
      dialogueLanguages: ["en"],
    },
    defaults: { resolution: "720p", durationS: 8, audio: true },
    // $0.10 a second at 720p ($0.12 at 1080p).
    pricePerSecondUsd: 0.1,
    timeoutS: 1800,
  },
  {
    key: "veo-3.1-lite",
    family: "veo",
    label: "Veo 3.1 Lite",
    vendor: "Google",
    credential: "google",
    modelId: "veo-3.1-lite-generate-preview",
    // 1080p exists upstream but only for 8 s clips.
    capabilities: {
      aspectRatios: ["9:16", "16:9"],
      resolutions: ["720p"],
      durationsS: [4, 6, 8],
      audio: "always",
      dialogueLanguages: ["en"],
    },
    defaults: { resolution: "720p", durationS: 8, audio: true },
    // $0.05 a second at 720p ($0.08 at 1080p).
    pricePerSecondUsd: 0.05,
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
    capabilities: {
      aspectRatios: ["9:16", "16:9", "1:1"],
      resolutions: ["720p"],
      durationsS: range(3, 15),
      audio: "optional",
      dialogueLanguages: ["en", "zh"],
    },
    defaults: { resolution: "720p", durationS: 8, audio: true },
    // $0.126 a second with audio, $0.084 without.
    pricePerSecondUsd: 0.126,
    timeoutS: 1800,
    sendsResolution: false,
    promptMaxChars: 2500,
  },
  {
    key: "seedance-1.5-pro",
    family: "fal",
    label: "Seedance 1.5 Pro",
    vendor: "ByteDance via fal.ai",
    credential: "fal",
    modelId: "fal-ai/bytedance/seedance/v1.5/pro/text-to-video",
    capabilities: {
      aspectRatios: ["9:16", "16:9", "1:1"],
      resolutions: ["480p", "720p", "1080p"],
      durationsS: range(4, 12),
      audio: "optional",
      dialogueLanguages: ["en", "zh"],
    },
    defaults: { resolution: "720p", durationS: 8, audio: true },
    // Billed by video tokens (width x height x fps x seconds / 1024) at $2.40
    // per million with audio, $1.20 without: about $0.052 a second at 720p.
    pricePerSecondUsd: 0.052,
    timeoutS: 1800,
    sendsResolution: true,
  },
];

// Upstream ids to use instead of the ones above, for a newer model version
// without a Troupe release: TROUPE_MODEL_IDS="veo-3.1-fast=veo-3.1-fast-generate-001,
// kling-3.0=fal-ai/kling-video/v3/pro/text-to-video". The capabilities stay
// the built-in ones, so the replacement must accept the same settings.
const MODEL_ID = /^[a-z0-9][a-z0-9._-]*(?:\/[a-zA-Z0-9._-]+)*$/;

export function parseModelIdOverrides(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (raw ?? "").split(",")) {
    const [key, id] = part.split("=").map((s) => s.trim());
    if (key && id && MODEL_ID.test(id) && BUILTIN_MODELS.some((m) => m.key === key)) out[key] = id;
  }
  return out;
}

export function builtinModels(env: Record<string, string | undefined> = {}): readonly BuiltinModel[] {
  const ids = parseModelIdOverrides(env.TROUPE_MODEL_IDS);
  return BUILTIN_MODELS.map((m) => {
    const id = ids[m.key];
    if (!id) return m;
    // A Gemini id has no slash; a fal endpoint has at least one.
    return (m.family === "fal") === id.includes("/") ? { ...m, modelId: id } : m;
  });
}

// Legacy `provider` values on rows written before the model catalog.
export const LEGACY_PROVIDER_MODEL_KEYS: Record<string, string> = {
  veo: "veo-3.1-fast",
  kling: "kling-3.0",
  seedance: "seedance-1.5-pro",
};
