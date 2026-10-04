// The wizard's four load-bearing choices live in one reducer — the
// page composes steps, it no longer owns eight useState hooks.

export const PLATFORMS = ["tiktok", "instagram", "youtube", "linkedin"] as const;
export const LANGUAGES = ["en", "fr", "de", "es", "it"] as const;
export const STEPS = ["Platform", "Format", "Language", "Actor"] as const;

export type Platform = (typeof PLATFORMS)[number];
export type Language = (typeof LANGUAGES)[number];
export type Format = "9:16" | "1:1" | "16:9";

export interface WizardState {
  step: number;
  title: string;
  platform: Platform;
  format: Format | null;
  language: Language;
  actorId: string | null;
  modelKey: string | null;
  submitError: string | null;
}

export const initialWizardState: WizardState = {
  step: 0,
  title: "",
  platform: "tiktok",
  format: null,
  language: "en",
  actorId: null,
  modelKey: null,
  submitError: null,
};

export type WizardAction =
  | { type: "title"; title: string }
  | { type: "platform"; platform: Platform }
  | { type: "format"; format: Format }
  | { type: "language"; language: Language }
  | { type: "actor"; actorId: string }
  | { type: "model"; modelKey: string | null }
  | { type: "submitError"; message: string | null }
  | { type: "back" }
  | { type: "next" };

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "title":
      return { ...state, title: action.title };
    case "platform":
      // A new platform resets the format: its recommended option differs.
      return { ...state, platform: action.platform, format: null };
    case "format":
      return { ...state, format: action.format };
    case "language":
      return { ...state, language: action.language };
    case "actor":
      return { ...state, actorId: action.actorId };
    case "model":
      return { ...state, modelKey: action.modelKey };
    case "submitError":
      return { ...state, submitError: action.message };
    case "back":
      return { ...state, step: Math.max(0, state.step - 1) };
    case "next":
      return { ...state, step: Math.min(STEPS.length - 1, state.step + 1) };
  }
}
