"use client";

import Link from "next/link";
import { useState } from "react";

import { ProviderWarning } from "~/app/_components/ui";
import { comparisonPlan, formatCost, launchSettings, type ModelOptionView } from "../model-choice";

export interface LaunchRequest {
  modelKey: string;
  durationS: number;
  resolution: string;
  audio: boolean;
}

// Pure view — pick a model, then only the clip lengths, resolutions and audio
// choice that model accepts. Everything shown comes from its capabilities.
export function LaunchPanel({
  options,
  model,
  estimatedS,
  busy,
  onModel,
  onLaunch,
  onCompare,
}: {
  options: ModelOptionView[];
  model: ModelOptionView | null;
  estimatedS: number;
  busy: boolean;
  onModel: (modelKey: string) => void;
  onLaunch: (request: LaunchRequest) => void;
  onCompare: (plan: { modelKeys: string[]; durationS: number; resolution: string }) => void;
}) {
  const [choice, setChoice] = useState<{ durationS?: number; resolution?: string; audio?: boolean }>({});
  const usable = options.filter((o) => o.available && o.compatible);
  if (usable.length === 0) {
    return (
      <ProviderWarning>
        No configured model can render this project&apos;s format.{" "}
        <Link href="/settings" className="underline">Check your models in Settings</Link>.
      </ProviderWarning>
    );
  }
  const settings = model ? launchSettings(model, estimatedS, choice) : null;
  const plan = comparisonPlan(options, estimatedS);
  const cost = model && settings?.durationS ? (model.pricePerSecondUsd === null ? (model.kind === "local" ? 0 : null) : model.pricePerSecondUsd * settings.durationS) : null;

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap gap-3">
        <label className="block min-w-[14rem] flex-1 text-sm">
          <span className="mb-1 block font-medium">Video model</span>
          <select aria-label="Video model" value={model?.key ?? ""} disabled={busy} className="w-full rounded-lg border border-muted/30 bg-bg px-3 py-2" onChange={(event) => { setChoice({}); onModel(event.target.value); }}>
            {model ? null : <option value="" disabled>Choose a model</option>}
            {usable.map((o) => <option key={o.key} value={o.key}>{o.label} · {o.kind}</option>)}
          </select>
        </label>
        {settings && !settings.tooLong ? (
          <>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Length</span>
              <select aria-label="Clip length" value={settings.durationS ?? ""} disabled={busy} className="rounded-lg border border-muted/30 bg-bg px-3 py-2" onChange={(event) => setChoice((c) => ({ ...c, durationS: Number(event.target.value) }))}>
                {settings.durations.map((d) => <option key={d} value={d}>{d} s</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Resolution</span>
              <select aria-label="Resolution" value={settings.resolution} disabled={busy || model!.capabilities.resolutions.length < 2} className="rounded-lg border border-muted/30 bg-bg px-3 py-2" onChange={(event) => setChoice((c) => ({ ...c, resolution: event.target.value }))}>
                {model!.capabilities.resolutions.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            {settings.audioToggle ? (
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input type="checkbox" checked={settings.audio} disabled={busy} onChange={(event) => setChoice((c) => ({ ...c, audio: event.target.checked }))} />
                Generate audio
              </label>
            ) : null}
          </>
        ) : null}
      </div>

      {model?.warnings.map((w) => <ProviderWarning key={w}>{w}</ProviderWarning>)}
      {settings?.tooLong ? (
        <ProviderWarning>
          This script is about {estimatedS}s long, but {model!.label} renders at most {settings.longestS}s. Shorten the script or choose another model.
        </ProviderWarning>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => model && settings?.durationS && onLaunch({ modelKey: model.key, durationS: settings.durationS, resolution: settings.resolution, audio: settings.audio })}
          disabled={busy || !model || !settings?.durationS}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
        >
          Launch draft
        </button>
        {plan.ok ? (
          <button type="button" className="rounded-lg border border-muted/30 px-4 py-2 text-sm disabled:opacity-40" disabled={busy} onClick={() => onCompare(plan)}>
            Compare {plan.modelKeys.length} models
          </button>
        ) : null}
        <span className="font-mono text-xs text-muted">{model?.kind === "local" ? "Runs on your machine." : cost === null ? "Billed by your provider." : `≈ ${formatCost(cost, "estimate")}`}</span>
      </div>
    </div>
  );
}
