// What one clip costs at the providers' list prices (pricing pages of
// 2026-10-05), for the settings actually sent. The live checks quote it
// before spending anything (pnpm verify:live, troupe doctor --live). No
// imports: the CLI reads this file as is.

export interface PricedModel {
  key: string;
  kind: "cloud" | "local";
  // The catalog's price per second, used for models not listed below.
  pricePerSecondUsd: number | null;
}

export interface ClipSettings {
  durationS: number;
  resolution: string;
  audio: boolean;
}

const cents = (usd: number) => Math.round(usd * 100) / 100;

// Veo: per second by resolution, audio included.
const VEO: Record<string, Record<string, number>> = {
  "veo-3.1-fast": { "720p": 0.1, "1080p": 0.12 },
  "veo-3.1-lite": { "720p": 0.05, "1080p": 0.08 },
};

// Seedance 1.5 Pro bills video tokens, width x height x fps x seconds / 1024,
// at $2.40 a million with audio and $1.20 without. Sizes are 9:16's.
const SEEDANCE_SIZES: Record<string, [number, number]> = { "480p": [480, 864], "720p": [720, 1280], "1080p": [1080, 1920] };

export function listPriceUsd(model: PricedModel, clip: ClipSettings): number | null {
  // Local models cost what their owner says, nothing by default.
  if (model.kind === "local") return model.pricePerSecondUsd ? cents(model.pricePerSecondUsd * clip.durationS) : 0;
  const veo = VEO[model.key]?.[clip.resolution];
  if (veo !== undefined) return cents(veo * clip.durationS);
  if (model.key === "kling-3.0") return cents((clip.audio ? 0.126 : 0.084) * clip.durationS);
  const size = model.key === "seedance-1.5-pro" ? SEEDANCE_SIZES[clip.resolution] : undefined;
  if (size) return cents(((size[0] * size[1] * 24 * clip.durationS) / 1024 / 1_000_000) * (clip.audio ? 2.4 : 1.2));
  return model.pricePerSecondUsd === null ? null : cents(model.pricePerSecondUsd * clip.durationS);
}

// One script chat answer from Claude Opus 5.5, the default chat model: about
// 2,000 tokens in and 1,000 to 4,500 out at $4 / $20 per million (adaptive
// thinking is billed as output, so the length varies).
export const CLAUDE_CHAT_ANSWER_USD = { lowUsd: 0.03, highUsd: 0.1 } as const;
