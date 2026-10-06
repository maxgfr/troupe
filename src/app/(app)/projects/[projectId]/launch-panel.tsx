"use client";

import Link from "next/link";
import { useState } from "react";

import { SELF_HOSTING_URL, useEdition } from "~/app/_components/edition";
import { Button, ProviderWarning, fieldClass, fieldSurface } from "~/app/_components/ui";
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
  const edition = useEdition();
  const rendering = edition.kind === "browser" ? edition.rendering : undefined;
  const usable = options.filter((o) => o.available && o.compatible);
  // The browser edition's own model exists but this browser cannot run it.
  const blocked = rendering ? options.find((o) => o.key === rendering.modelKey && !o.available) : undefined;
  if (usable.length === 0 && blocked) {
    return (
      <div className="mt-3">
        <ProviderWarning>
          {blocked.unavailableReason} Your project and script are saved in this browser; to render them on your machine,{" "}
          <a href={SELF_HOSTING_URL} target="_blank" rel="noreferrer" className="underline underline-offset-2">set up the self-hosted studio</a>.
        </ProviderWarning>
      </div>
    );
  }
  if (usable.length === 0) {
    return (
      <div className="mt-3">
        <ProviderWarning>
          No configured model can render this project&apos;s format.{" "}
          <Link href="/settings" className="underline">Check your models in Settings</Link>.
        </ProviderWarning>
      </div>
    );
  }
  const settings = model ? launchSettings(model, estimatedS, choice) : null;
  const inBrowser = Boolean(rendering && model?.key === rendering.modelKey);
  const plan = comparisonPlan(options, estimatedS);
  const cost = model && settings?.durationS ? (model.pricePerSecondUsd === null ? (model.kind === "local" ? 0 : null) : model.pricePerSecondUsd * settings.durationS) : null;

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap gap-3">
        <label className="block min-w-[14rem] flex-1 text-sm">
          <span className="mb-1.5 block font-medium">Video model</span>
          <select data-field aria-label="Video model" value={model?.key ?? ""} disabled={busy} className={fieldClass} onChange={(event) => { setChoice({}); onModel(event.target.value); }}>
            {model ? null : <option value="" disabled>Choose a model</option>}
            {usable.map((o) => <option key={o.key} value={o.key}>{o.label} · {o.kind}</option>)}
          </select>
        </label>
        {settings && !settings.tooLong ? (
          <>
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium">Length</span>
              <select data-field aria-label="Clip length" value={settings.durationS ?? ""} disabled={busy} className={`${fieldSurface} bg-surface px-3 py-2 font-mono text-sm tabular-nums`} onChange={(event) => setChoice((c) => ({ ...c, durationS: Number(event.target.value) }))}>
                {settings.durations.map((d) => <option key={d} value={d}>{d} s</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium">Resolution</span>
              <select data-field aria-label="Resolution" value={settings.resolution} disabled={busy || model!.capabilities.resolutions.length < 2} className={`${fieldSurface} bg-surface px-3 py-2 font-mono text-sm tabular-nums`} onChange={(event) => setChoice((c) => ({ ...c, resolution: event.target.value }))}>
                {model!.capabilities.resolutions.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            {settings.audioToggle ? (
              <label className="flex min-h-10 items-center gap-2 self-end text-sm">
                <input type="checkbox" className="size-4 accent-[var(--troupe-color-primary)]" checked={settings.audio} disabled={busy} onChange={(event) => setChoice((c) => ({ ...c, audio: event.target.checked }))} />
                Generate audio
              </label>
            ) : null}
          </>
        ) : null}
      </div>

      {model?.warnings.map((w) => <ProviderWarning key={w}>{w}</ProviderWarning>)}
      {inBrowser && rendering ? <rendering.LaunchNote /> : null}
      {settings?.tooLong ? (
        <ProviderWarning>
          This script is about {estimatedS}s long, but {model!.label} renders at most {settings.longestS}s. Shorten the script or choose another model.
        </ProviderWarning>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          size="lg"
          onClick={() => model && settings?.durationS && onLaunch({ modelKey: model.key, durationS: settings.durationS, resolution: settings.resolution, audio: settings.audio })}
          disabled={busy || !model || !settings?.durationS}
        >
          Launch draft
        </Button>
        {plan.ok ? (
          <Button size="lg" disabled={busy} onClick={() => onCompare(plan)}>
            Compare {plan.modelKeys.length} models
          </Button>
        ) : null}
        <span className="font-mono text-xs text-muted">{inBrowser ? "Runs in this browser." : model?.kind === "local" ? "Runs on your machine." : cost === null ? "Billed by your provider." : `≈ ${formatCost(cost, "estimate")}`}</span>
      </div>
      <p className="max-w-[65ch] text-pretty text-xs text-muted">
        Every render is a draft to review here. The one you export becomes final.
      </p>
    </div>
  );
}
