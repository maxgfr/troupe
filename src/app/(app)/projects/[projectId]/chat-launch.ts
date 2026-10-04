import { launchSettings, type ModelOptionView } from "../model-choice";

// What the chat measures against and relaunches with: the newest render's
// model and settings when that model can still launch, else the launch
// panel's model with its defaults. The word budget and "Apply & relaunch"
// read the same plan, so a proposal that fits the budget fits the relaunch.

export interface PreviousRender {
  modelKey: string;
  durationS: number;
  resolution: string;
}

export interface ChatLaunchBase {
  model: ModelOptionView;
  choice: { durationS?: number; resolution?: string };
}

export function chatLaunchBase(options: ModelOptionView[], fallback: ModelOptionView | null, previous: PreviousRender | null): ChatLaunchBase | null {
  const again = previous ? options.find((o) => o.key === previous.modelKey && o.available && o.compatible) : undefined;
  if (again && previous) return { model: again, choice: { durationS: previous.durationS, resolution: previous.resolution } };
  return fallback ? { model: fallback, choice: {} } : null;
}

// The clip length the chat writes for: the plan's length for the current
// script, else the model's default (8 s with no model at all).
export function chatClipSeconds(base: ChatLaunchBase | null, currentEstimateS: number): number {
  if (!base) return 8;
  const settings = launchSettings(base.model, currentEstimateS, base.choice);
  return settings.durationS ?? base.model.defaults.durationS;
}

export type RelaunchPlan =
  | { ok: true; request: { modelKey: string; tier: "draft"; durationS: number; resolution: string; audio: boolean }; label: string }
  | { ok: false; reason: string };

// The launch for a proposal of `estimatedS` seconds: the same model and
// settings, with a longer clip only when the new lines need one.
export function relaunchPlan(base: ChatLaunchBase | null, estimatedS: number): RelaunchPlan {
  if (!base) return { ok: false, reason: "No model can render this project yet. Check your models in Settings." };
  const settings = launchSettings(base.model, estimatedS, base.choice);
  if (settings.tooLong || !settings.durationS) {
    return { ok: false, reason: `About ${estimatedS} s to say: ${base.model.label} renders at most ${settings.longestS} s.` };
  }
  return {
    ok: true,
    request: { modelKey: base.model.key, tier: "draft", durationS: settings.durationS, resolution: settings.resolution, audio: settings.audio },
    label: `${base.model.label} · ${settings.durationS} s · ${settings.resolution}`,
  };
}
