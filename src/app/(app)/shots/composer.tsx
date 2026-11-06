"use client";

import { useEffect, useRef } from "react";

import { Button, ErrorNote, Kbd, ProviderWarning, chipClass, panelClass } from "~/app/_components/ui";
import { ModelPicker } from "./model-picker";
import { MAX_RENDERS, estimateUsd, type ShotCapabilities, type ShotSettings } from "./shot-settings";
import type { ShotModel } from "./types";

export interface ComposerActor {
  id: string;
  name: string;
}

// The one text field of the Shots page and, under it, the chosen models and
// the choices they all offer: format, length, resolution, sound, an actor,
// how many on each. ⌘/Ctrl + Enter launches.
export function Composer({
  text,
  onText,
  models,
  chosen,
  onToggleModel,
  capabilities,
  missing,
  soundPerModel,
  settings,
  onSettings,
  actors,
  actorId,
  onActor,
  count,
  onCount,
  launching,
  error,
  onLaunch,
  focusNonce,
}: {
  text: string;
  onText: (text: string) => void;
  models: ShotModel[];
  chosen: ShotModel[];
  onToggleModel: (model: ShotModel) => void;
  // What every chosen model renders (sharedCapabilities).
  capabilities: ShotCapabilities | null;
  // Why the chosen models cannot launch together, in a sentence.
  missing: string | null;
  // The chosen models follow different sound rules.
  soundPerModel: boolean;
  settings: ShotSettings | null;
  onSettings: (patch: Partial<ShotSettings>) => void;
  actors: ComposerActor[];
  actorId: string | null;
  onActor: (id: string | null) => void;
  count: number;
  onCount: (count: number) => void;
  launching: boolean;
  error: string | null;
  onLaunch: () => void;
  // Changes when something (Reuse, a starter) wants the field focused.
  focusNonce: number;
}) {
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusNonce === 0) return;
    const node = field.current;
    node?.focus();
    node?.setSelectionRange(node.value.length, node.value.length);
  }, [focusNonce]);

  const caps = missing ? null : capabilities;
  const renders = chosen.length * count;
  const cost = settings
    ? estimateUsd(
        chosen.map((m) => m.pricePerSecondUsd),
        settings.durationS,
        count,
      )
    : null;
  const canLaunch = Boolean(chosen.length && caps && settings && text.trim()) && !launching;
  const unavailable = chosen.filter((m) => !m.available && m.status !== "missing-credentials");
  // As many renders per model as keep the launch within MAX_RENDERS.
  const counts = [1, 2, 3, 4].filter((n) => n === 1 || n * Math.max(chosen.length, 1) <= MAX_RENDERS);

  return (
    <form
      className={`${panelClass} p-3 sm:p-4`}
      onSubmit={(event) => {
        event.preventDefault();
        if (canLaunch) onLaunch();
      }}
    >
      <label htmlFor="shot-text" className="sr-only">
        Describe the shot
      </label>
      <textarea
        id="shot-text"
        ref={field}
        rows={2}
        value={text}
        maxLength={chosen[0]?.promptMaxChars}
        onChange={(event) => onText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (canLaunch) onLaunch();
          }
        }}
        placeholder="Describe the shot: who or what, where, the light, how the camera moves…"
        className="field-sizing-content block max-h-56 min-h-14 w-full resize-none bg-transparent px-1 py-1 text-[0.9375rem] leading-relaxed text-fg outline-none placeholder:text-muted/80"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ModelPicker models={models} value={chosen} onToggle={onToggleModel} />

        {caps && settings ? (
          <>
            {caps.aspectRatios.length > 1 ? (
              <fieldset className="flex items-center gap-1">
                <legend className="sr-only">Format</legend>
                {caps.aspectRatios.map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    aria-pressed={settings.aspectRatio === ratio}
                    onClick={() => onSettings({ aspectRatio: ratio })}
                    className={chipClass(settings.aspectRatio === ratio, "font-mono", "sm")}
                  >
                    {ratio}
                  </button>
                ))}
              </fieldset>
            ) : (
              <span className={chipClass(false, "pointer-events-none font-mono", "sm")}>{settings.aspectRatio}</span>
            )}

            <ChipSelect
              label="Length"
              value={String(settings.durationS)}
              options={caps.durationsS.map((s) => ({ value: String(s), label: `${s} s` }))}
              onChange={(v) => onSettings({ durationS: Number(v) })}
            />

            {caps.resolutions.length > 1 ? (
              <ChipSelect
                label="Resolution"
                value={settings.resolution}
                options={caps.resolutions.map((r) => ({ value: r, label: r }))}
                onChange={(v) => onSettings({ resolution: v })}
              />
            ) : null}

            {caps.audio === "optional" ? (
              <button
                type="button"
                aria-pressed={settings.audio}
                onClick={() => onSettings({ audio: !settings.audio })}
                title={
                  soundPerModel ? "Only for the models that offer the choice; the others keep their own." : undefined
                }
                className={chipClass(settings.audio, "", "sm")}
              >
                {settings.audio ? "Sound on" : "Silent"}
                {soundPerModel ? <span className="text-muted">where offered</span> : null}
              </button>
            ) : (
              <span className={chipClass(false, "pointer-events-none", "sm")}>
                {soundPerModel ? "Sound per model" : caps.audio === "always" ? "Always with sound" : "Silent"}
              </span>
            )}
          </>
        ) : null}

        <ChipSelect
          label="Actor"
          value={actorId ?? ""}
          options={[{ value: "", label: "No actor" }, ...actors.map((a) => ({ value: a.id, label: a.name }))]}
          onChange={(v) => onActor(v || null)}
        />

        <ChipSelect
          label={chosen.length > 1 ? "How many on each model" : "How many"}
          value={String(Math.min(count, counts.at(-1)!))}
          options={counts.map((n) => ({ value: String(n), label: chosen.length > 1 ? `×${n} each` : `×${n}` }))}
          onChange={(v) => onCount(Number(v))}
        />

        <div className="ml-auto flex items-center gap-3">
          {cost != null ? (
            <span className="font-mono text-xs tabular-nums text-muted">
              {cost === 0 ? "free (local)" : `$${cost.toFixed(2)} est.`}
            </span>
          ) : null}
          <Button type="submit" variant="primary" disabled={!canLaunch}>
            {launching ? "Launching…" : renders > 1 ? `Launch ${renders}` : "Launch"}
            <span className="max-sm:hidden" aria-hidden>
              <Kbd>⌘↵</Kbd>
            </span>
          </Button>
        </div>
      </div>

      {missing ? (
        <div className="mt-3">
          <ProviderWarning>{missing}</ProviderWarning>
        </div>
      ) : null}
      {unavailable.map((m) => (
        <p key={m.key} className="mt-3 text-sm text-warning">
          {m.unavailableReason}
        </p>
      ))}
      {error ? (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      ) : null}
    </form>
  );
}

// A pill holding a native select: compact like a chip, accessible and
// usable on a phone like a select.
function ChipSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className={chipClass(false, "relative", "sm")}>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="cursor-pointer appearance-none bg-transparent pr-1 text-fg outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
