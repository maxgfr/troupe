"use client";

import { disclosureFor } from "~/modules/export/server/disclosure";
import { ProviderWarning } from "~/app/_components/ui";

// The export form's panels, one named component each — the page
// composes them; presets and disclosure rules evolve here, not in a 200-line
// JSX block.

export const PLATFORMS = ["tiktok", "instagram", "youtube", "linkedin"] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface CompletedRender {
  id: string;
  tier: string;
  provider: string;
  durationS: number;
  createdAt: string | Date;
}

export function RenderPicker({
  completed,
  chosen,
  onChoose,
}: {
  completed: CompletedRender[];
  chosen: string | null;
  onChoose: (id: string) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">Render</legend>
      <div className="space-y-2">
        {completed.map((g) => (
          <label
            key={g.id}
            className={`flex cursor-pointer items-center justify-between rounded-lg border px-4 py-2.5 font-mono text-xs transition-colors duration-150 ${
              chosen === g.id ? "border-primary bg-primary/15" : "border-muted/40"
            }`}
          >
            <input
              type="radio"
              name="generation"
              className="sr-only"
              checked={chosen === g.id}
              onChange={() => onChoose(g.id)}
            />
            {g.tier} · {g.provider} · {g.durationS}s
            <span className="text-muted">{new Date(g.createdAt).toLocaleString()}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function PlatformPreset({
  platform,
  onPick,
  specsMismatch,
}: {
  platform: Platform;
  onPick: (p: Platform) => void;
  specsMismatch: boolean;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">Platform preset</legend>
      <div className="flex flex-wrap gap-2">
        {PLATFORMS.map((p) => (
          <label
            key={p}
            className={`cursor-pointer rounded-lg border px-4 py-2 text-sm capitalize transition-colors duration-150 ${
              platform === p
                ? "border-primary bg-primary/15 font-medium text-primary"
                : "border-muted/40 text-muted hover:text-fg"
            }`}
          >
            <input
              type="radio"
              name="platform"
              className="sr-only"
              checked={platform === p}
              onChange={() => onPick(p)}
            />
            {p}
          </label>
        ))}
      </div>
      {specsMismatch ? (
        <ProviderWarning>
          This render has a different format from the {platform} preset. Downloading keeps the original format; crop it in your video editor if needed.
        </ProviderWarning>
      ) : null}
    </fieldset>
  );
}

export function CaptionFields({
  caption,
  hashtags,
  onCaption,
  onHashtags,
}: {
  caption: string;
  hashtags: string;
  onCaption: (v: string) => void;
  onHashtags: (v: string) => void;
}) {
  return (
    <>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Caption</span>
        <textarea
          value={caption}
          onChange={(e) => onCaption(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-muted/40 bg-bg px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-primary"
        />
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium">Hashtags</span>
        <input
          value={hashtags}
          onChange={(e) => onHashtags(e.target.value)}
          className="w-full rounded-lg border border-muted/40 bg-bg px-3 py-2 font-mono text-sm outline-none transition-colors duration-150 focus:border-primary"
        />
      </label>
    </>
  );
}

// The disclosure obligation is platform law — state the
// exact requirement for the chosen platform.
export function DisclosurePanel({ platform }: { platform: Platform }) {
  return (
    <div className="rounded-lg bg-surface px-3 py-2 text-xs" data-testid="disclosure-matrix">
      <p className="font-medium">{disclosureFor(platform).headline}</p>
      <p className="mt-1 text-muted">{disclosureFor(platform).detail}</p>
    </div>
  );
}
