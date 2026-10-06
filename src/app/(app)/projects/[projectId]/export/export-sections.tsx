"use client";

import { disclosureFor } from "~/modules/export/disclosure";
import { PLATFORMS, platformName, type PlatformId } from "~/modules/studio/platforms";
import { ProviderWarning, chipClass, fieldClass } from "~/app/_components/ui";
import { shownLength } from "../generation-timeline";

// The export form's panels, one named component each — the page
// composes them; presets and disclosure rules evolve here, not in a 200-line
// JSX block.

export { PLATFORMS };
export type Platform = PlatformId;

export interface CompletedRender {
  id: string;
  tier: string;
  provider: string;
  modelLabel?: string | null;
  durationS: number;
  mediaDurationS?: number | null;
  createdAt: string | Date;
  // The video, for a still in the picker.
  outputAssetUrl?: string | null;
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
      <legend className="mb-3 text-xl font-semibold tracking-[-0.01em]">Render</legend>
      <div className="space-y-2">
        {completed.map((g) => (
          <label
            key={g.id}
            className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-[background-color,box-shadow] duration-150 ${
              chosen === g.id ? "bg-primary/10 shadow-[inset_0_0_0_1.5px_var(--troupe-color-primary)]" : "shadow-[inset_0_0_0_1px_var(--troupe-color-line)] hover:bg-fg/[0.04]"
            }`}
          >
            <input
              type="radio"
              name="generation"
              className="sr-only"
              checked={chosen === g.id}
              onChange={() => onChoose(g.id)}
            />
            {g.outputAssetUrl ? (
              <span aria-hidden className="block h-14 w-10 shrink-0 overflow-hidden rounded-md bg-black shadow-[inset_0_0_0_1px_var(--picture-edge)]">
                <video src={`${g.outputAssetUrl}#t=0.6`} muted playsInline preload="metadata" className="size-full object-cover" />
              </span>
            ) : null}
            <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <span className="min-w-0">
                <span className="font-medium">{g.modelLabel ?? g.provider}</span>
                <span className="font-mono text-xs tabular-nums text-muted">{` · ${shownLength(g)} · ${g.tier === "final" ? "final" : "draft"}`}</span>
              </span>
              <span className="font-mono text-xs tabular-nums text-muted"><span className="sr-only">, made </span>{new Date(g.createdAt).toLocaleString()}</span>
            </span>
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
      <legend className="mb-3 text-xl font-semibold tracking-[-0.01em]">Platform</legend>
      <div className="flex flex-wrap gap-2">
        {PLATFORMS.map((p) => (
          <label
            key={p}
            className={chipClass(platform === p)}
          >
            <input
              type="radio"
              name="platform"
              className="sr-only"
              checked={platform === p}
              onChange={() => onPick(p)}
            />
            {platformName(p)}
          </label>
        ))}
      </div>
      {specsMismatch ? (
        <div className="mt-3">
          <ProviderWarning>
            This render has a different format from the {platformName(platform)} preset. Downloading keeps the original format; crop it in your video editor if needed.
          </ProviderWarning>
        </div>
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
        <span className="mb-1.5 block font-medium">Caption</span>
        <textarea
          value={caption}
          onChange={(e) => onCaption(e.target.value)}
          rows={3}
          className={fieldClass}
        />
      </label>

      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Hashtags</span>
        <input
          value={hashtags}
          onChange={(e) => onHashtags(e.target.value)}
          className={`${fieldClass} font-mono`}
        />
      </label>
    </>
  );
}

// The disclosure obligation is platform law — state the
// exact requirement for the chosen platform.
export function DisclosurePanel({ platform }: { platform: Platform }) {
  return (
    <div className="rounded-xl bg-surface px-4 py-3 text-sm" data-testid="disclosure-matrix">
      <p className="font-medium">{disclosureFor(platform).headline}</p>
      <p className="mt-1 text-pretty text-xs text-muted">{disclosureFor(platform).detail}</p>
    </div>
  );
}
