// The platforms a project is made for, as their owners write them.
export const PLATFORMS = ["tiktok", "instagram", "youtube", "linkedin"] as const;
export type PlatformId = (typeof PLATFORMS)[number];

const NAMES: Record<PlatformId, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  linkedin: "LinkedIn",
};

export function platformName(platform: string): string {
  return NAMES[platform as PlatformId] ?? platform;
}
