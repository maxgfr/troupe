// The Shots composer's settings, worked out from what each model declares
// (its capabilities): the page draws only the choices a model offers, and a
// value a model cannot take never reaches a launch.

export interface ShotCapabilities {
  aspectRatios: string[];
  resolutions: string[];
  durationsS: number[];
  audio: "always" | "optional" | "none";
}

export interface ShotDefaults {
  resolution: string;
  durationS: number;
  audio: boolean;
}

export interface ShotSettings {
  aspectRatio: string;
  durationS: number;
  resolution: string;
  audio: boolean;
}

// Vertical first: most shots end up on a phone.
const PREFERRED_RATIOS = ["9:16", "16:9", "1:1"];

const pick = <T>(allowed: readonly T[], wanted: T | undefined, fallback: T | undefined): T =>
  wanted !== undefined && allowed.includes(wanted)
    ? wanted
    : fallback !== undefined && allowed.includes(fallback)
      ? fallback
      : allowed[0]!;

// The settings to show for a model: the ones last used on it when it still
// takes them, else its defaults.
export function settingsFor(
  caps: ShotCapabilities,
  defaults: ShotDefaults,
  saved?: Partial<ShotSettings> | null,
): ShotSettings {
  const ratio = PREFERRED_RATIOS.find((r) => caps.aspectRatios.includes(r));
  return {
    aspectRatio: pick(caps.aspectRatios, saved?.aspectRatio, ratio),
    durationS: pick(caps.durationsS, saved?.durationS, defaults.durationS),
    resolution: pick(caps.resolutions, saved?.resolution, defaults.resolution),
    audio: caps.audio === "always" ? true : caps.audio === "none" ? false : (saved?.audio ?? defaults.audio),
  };
}

// At most this many models side by side (the server holds the same limits).
export const MAX_MODELS = 4;
export const MAX_RENDERS = 8;

export interface ShotChoice {
  key: string;
  label: string;
  capabilities: ShotCapabilities;
}

// "A", "A and B", "A, B and C".
export const listNames = (names: string[]): string =>
  names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

const common = <T>(lists: T[][]): T[] => lists.reduce((shared, list) => shared.filter((v) => list.includes(v)));

// What several models side by side can all render: the formats, lengths and
// resolutions they share. Sound is a choice when one of them offers it (the
// others keep their own rule). `missing` names the first setting they share
// none of, in a sentence, so the page says so before any call.
export function sharedCapabilities(
  models: ShotChoice[],
): { capabilities: ShotCapabilities; missing: string | null; soundPerModel: boolean } | null {
  if (models.length === 0) return null;
  const caps = models.map((m) => m.capabilities);
  // Models with different sound rules: the choice, when there is one, only
  // reaches those that offer it.
  const soundPerModel = caps.some((c) => c.audio !== caps[0]!.audio);
  const capabilities: ShotCapabilities = {
    aspectRatios: common(caps.map((c) => c.aspectRatios)),
    durationsS: common(caps.map((c) => c.durationsS)),
    resolutions: common(caps.map((c) => c.resolutions)),
    audio: caps.some((c) => c.audio === "optional") ? "optional" : caps[0]!.audio,
  };
  const names = listNames(models.map((m) => m.label));
  const missing =
    capabilities.aspectRatios.length === 0
      ? `${names} share no format. Choose other models.`
      : capabilities.durationsS.length === 0
        ? `${names} share no clip length. Choose other models.`
        : capabilities.resolutions.length === 0
          ? `${names} share no resolution. Choose other models.`
          : null;
  return { capabilities, missing, soundPerModel };
}

// Where the settings of a selection are remembered: one entry per set of
// models, whatever order they were picked in.
export const selectionKey = (keys: string[]): string => [...keys].sort().join("+");

// An estimate for `count` renders on each model, or null when none has a price.
export function estimateUsd(pricesPerSecondUsd: (number | null)[], durationS: number, count: number): number | null {
  const priced = pricesPerSecondUsd.filter((p): p is number => p != null);
  return priced.length === 0 ? null : priced.reduce((sum, p) => sum + p, 0) * durationS * count;
}

// "16:9" → "16 / 9", for the CSS aspect-ratio of a tile.
export function cssRatio(aspectRatio: string): string {
  const [w, h] = aspectRatio.split(":").map(Number);
  return w && h ? `${w} / ${h}` : "9 / 16";
}

// --- What the composer keeps between visits (this browser only) --------------

export interface ComposerMemory {
  text: string;
  // The models chosen, in the order they were picked.
  modelKeys: string[];
  actorId: string | null;
  count: number;
  // The settings last used on each model or set of models (selectionKey).
  byModel: Record<string, Partial<ShotSettings>>;
}

export const MEMORY_KEY = "troupe.shots.composer";

export const EMPTY_MEMORY: ComposerMemory = { text: "", modelKeys: [], actorId: null, count: 1, byModel: {} };

export function parseMemory(raw: string | null): ComposerMemory {
  if (!raw) return EMPTY_MEMORY;
  try {
    const value = JSON.parse(raw) as Partial<ComposerMemory> & { modelKey?: unknown };
    const keys = Array.isArray(value.modelKeys)
      ? value.modelKeys.filter((k): k is string => typeof k === "string")
      : // The first version kept one model.
        typeof value.modelKey === "string"
        ? [value.modelKey]
        : [];
    return {
      text: typeof value.text === "string" ? value.text : "",
      modelKeys: [...new Set(keys)].slice(0, MAX_MODELS),
      actorId: typeof value.actorId === "string" ? value.actorId : null,
      count: typeof value.count === "number" && value.count >= 1 && value.count <= 4 ? Math.floor(value.count) : 1,
      byModel: value.byModel && typeof value.byModel === "object" ? value.byModel : {},
    };
  } catch {
    return EMPTY_MEMORY;
  }
}

// Models whose name, vendor or key holds every word of the query.
export function matchModels<T extends { key: string; label: string; vendor: string }>(models: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return models;
  return models.filter((m) => {
    const hay = `${m.label} ${m.vendor} ${m.key}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
