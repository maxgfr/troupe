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
export function pickModel(
  options: ModelOptionView[],
  preferred: string | null | undefined,
  defaultKey: string | null | undefined,
): ModelOptionView | null {
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

export function launchSettings(
  option: ModelOptionView,
  estimatedS: number,
  choice: { durationS?: number | null; resolution?: string | null; audio?: boolean | null } = {},
): LaunchSettings {
  const caps = option.capabilities;
  const durations = caps.durationsS.filter((d) => d >= estimatedS);
  const longestS = Math.max(0, ...caps.durationsS);
  // The user's pick, else the model's default length (Settings → Launch
  // defaults) when the script fits it, else the shortest clip that fits.
  // comparisonPlan applies the same rule.
  const preferred = [choice.durationS, option.defaults.durationS].find((d) => d != null && durations.includes(d));
  return {
    durations,
    durationS: preferred ?? durations[0] ?? null,
    resolution:
      choice.resolution && caps.resolutions.includes(choice.resolution)
        ? choice.resolution
        : option.defaults.resolution,
    audioToggle: caps.audio === "optional",
    audio: caps.audio === "always" ? true : caps.audio === "none" ? false : (choice.audio ?? option.defaults.audio),
    tooLong: durations.length === 0,
    longestS,
  };
}

export type ComparisonPlan =
  | { ok: true; modelKeys: string[]; durationS: number; resolution: string }
  | { ok: false; reason: string };

// Up to three models that share a duration and a resolution fitting the
// script. The length follows Launch's rule with the first model's default.
export function comparisonPlan(options: ModelOptionView[], estimatedS: number): ComparisonPlan {
  // A model none of whose clips holds the script cannot take part, and must
  // not keep the others from being compared.
  const candidates = options.filter((o) => usable(o) && o.capabilities.durationsS.some((d) => d >= estimatedS));
  if (candidates.length < 2)
    return {
      ok: false,
      reason: "Comparing needs at least two models that can render this format at this script's length.",
    };
  for (let size = Math.min(3, candidates.length); size >= 2; size--) {
    const group = candidates.slice(0, size);
    const durations = group[0]!.capabilities.durationsS.filter(
      (d) => d >= estimatedS && group.every((o) => o.capabilities.durationsS.includes(d)),
    );
    const resolutions = group[0]!.capabilities.resolutions.filter((r) =>
      group.every((o) => o.capabilities.resolutions.includes(r)),
    );
    if (durations.length && resolutions.length) {
      const preferred = group[0]!.defaults.durationS;
      return {
        ok: true,
        modelKeys: group.map((o) => o.key),
        durationS: durations.includes(preferred) ? preferred : durations[0]!,
        resolution: resolutions.includes("720p") ? "720p" : resolutions[0]!,
      };
    }
  }
  return {
    ok: false,
    reason:
      "Comparing needs at least two models that share a clip length and a resolution for this script; these share none.",
  };
}

export function formatCost(
  costUsd: number | null | undefined,
  source: "estimate" | "provider" | null | undefined,
): string {
  if (costUsd == null) return "—";
  if (costUsd === 0) return source === "estimate" ? "free (local)" : "$0.00";
  return `$${costUsd.toFixed(2)}${source === "estimate" ? " est." : ""}`;
}
