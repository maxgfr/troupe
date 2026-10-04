// The AI-disclosure requirement differs per platform — a
// wrong or missing one is a strike (TikTok) or an FTC exposure, so the export
// screen states the exact obligation for the chosen platform instead of a
// generic reassurance. Grounded in docs/market/2026-07-12/REPORT.md [S7].
export type DisclosureRequirement = "toggle" | "platform-label" | "upload-disclosure" | "caption";

export interface PlatformDisclosure {
  requirement: DisclosureRequirement;
  headline: string;
  detail: string;
}

const MATRIX: Record<string, PlatformDisclosure> = {
  tiktok: {
    requirement: "toggle",
    headline: "TikTok — AI-generated content toggle required",
    detail:
      "Switch the AI-generated content toggle ON when publishing: realistic AI video without it risks removal or an account strike. The export metadata carries the AI label either way.",
  },
  instagram: {
    requirement: "platform-label",
    headline: "Instagram — Meta applies its AI label",
    detail:
      "Meta auto-labels AI content from upload metadata; this export embeds the disclosure so the label resolves correctly.",
  },
  youtube: {
    requirement: "upload-disclosure",
    headline: "YouTube — altered/synthetic content disclosure",
    detail:
      "Declare altered or synthetic content in the YouTube upload flow for realistic AI video; the export metadata carries the AI label.",
  },
  linkedin: {
    requirement: "caption",
    headline: "LinkedIn — disclosure travels in the caption",
    detail:
      "LinkedIn has no dedicated AI toggle: the disclosure line ships inside the caption of this export.",
  },
};

export function disclosureFor(platform: string): PlatformDisclosure {
  const entry = MATRIX[platform];
  if (!entry) {
    return {
      requirement: "caption",
      headline: `${platform} — disclosure in the caption`,
      detail: "No platform-specific AI mechanism is known: the disclosure line ships inside the caption.",
    };
  }
  return entry;
}
