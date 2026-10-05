// Pure launch decisions shared by the wizard, the project page and the
// benchmark lab: which model, which duration and resolution, which models
// can be compared. Everything comes from the model's declared capabilities.

export interface ModelOptionView {
  key: string;
  label: string;
  vendor: string;
  kind: "cloud" | "local";
  capabilities: {
    aspectRatios: string[];
    resolutions: string[];
    durationsS: number[];
    audio: "always" | "optional" | "none";
    dialogueLanguages: string[] | null;
  };
  defaults: { resolution: string; durationS: number; audio: boolean };
  pricePerSecondUsd: number | null;
  available: boolean;
  unavailableReason: string | null;
  compatible: boolean;
  warnings: string[];
}

const usable = (o: ModelOptionView) => o.available && o.compatible;

// The project's own choice, else the studio default, else the first model
// that can render this project.
export function pickModel(options: ModelOptionView[], preferred: string | null | undefined, defaultKey: string | null | undefined): ModelOptionView | null {
  const find = (key: string | null | undefined) => (key ? options.find((o) => o.key === key && usable(o)) : undefined);
  return find(preferred) ?? find(defaultKey) ?? options.find(usable) ?? null;
}

export interface LaunchSettings {
  // Durations long enough for the script.
  durations: number[];
  durationS: number | null;
  resolution: string;
  audioToggle: boolean;
  audio: boolean;
  // The script needs more than the model's longest clip.
  tooLong: boolean;
  longestS: number;
}

export function launchSettings(option: ModelOptionView, estimatedS: number, choice: { durationS?: number | null; resolution?: string | null; audio?: boolean | null } = {}): LaunchSettings {
  const caps = option.capabilities;
  const durations = caps.durationsS.filter((d) => d >= estimatedS);
  const longestS = Math.max(0, ...caps.durationsS);
  // The script sets the length: the shortest clip that fits it, as a
  // comparison picks, unless the user chose another one.
  const chosen = choice.durationS != null && durations.includes(choice.durationS) ? choice.durationS : null;
  return {
    durations,
    durationS: chosen ?? durations[0] ?? null,
    resolution: choice.resolution && caps.resolutions.includes(choice.resolution) ? choice.resolution : option.defaults.resolution,
    audioToggle: caps.audio === "optional",
    audio: caps.audio === "always" ? true : caps.audio === "none" ? false : (choice.audio ?? option.defaults.audio),
    tooLong: durations.length === 0,
    longestS,
  };
}

export type ComparisonPlan =
  | { ok: true; modelKeys: string[]; durationS: number; resolution: string }
  | { ok: false; reason: string };

// Up to three models that share a duration and a resolution fitting the script.
export function comparisonPlan(options: ModelOptionView[], estimatedS: number): ComparisonPlan {
  const candidates = options.filter(usable);
  if (candidates.length < 2) return { ok: false, reason: "Comparing needs at least two available models for this format." };
  for (let size = Math.min(3, candidates.length); size >= 2; size--) {
    const group = candidates.slice(0, size);
    const durations = group[0]!.capabilities.durationsS.filter((d) => d >= estimatedS && group.every((o) => o.capabilities.durationsS.includes(d)));
    const resolutions = group[0]!.capabilities.resolutions.filter((r) => group.every((o) => o.capabilities.resolutions.includes(r)));
    if (durations.length && resolutions.length) {
      return { ok: true, modelKeys: group.map((o) => o.key), durationS: durations[0]!, resolution: resolutions.includes("720p") ? "720p" : resolutions[0]! };
    }
  }
  return { ok: false, reason: "These models share no clip length and resolution that fits this script." };
}

export function formatCost(costUsd: number | null | undefined, source: "estimate" | "provider" | null | undefined): string {
  if (costUsd == null) return "—";
  if (costUsd === 0) return source === "estimate" ? "free (local)" : "$0.00";
  return `$${costUsd.toFixed(2)}${source === "estimate" ? " est." : ""}`;
}
