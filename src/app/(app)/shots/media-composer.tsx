"use client";

import { useEffect, useRef } from "react";

import { Button, ErrorNote, Kbd, chipClass, panelClass } from "~/app/_components/ui";
import type { ComposerActor } from "./composer";
import { ModelPicker } from "./model-picker";
import { MAX_RENDERS } from "./shot-settings";
import type { MediaShotModel } from "./types";

// The Photo and Voice composers of the Shots page: the same field, the
// models of that medium, and only the choices they take. A photo: its
// format, how many, an actor whose look it follows. A voice clip: one
// model, its voice, a delivery, an actor whose delivery it takes.
export function MediaComposer({
  medium,
  text,
  onText,
  models,
  chosen,
  onToggleModel,
  onBrowseModels,
  aspectRatios,
  aspectRatio,
  onAspectRatio,
  voice,
  onVoice,
  instructions,
  onInstructions,
  actors,
  actorId,
  onActor,
  count,
  onCount,
  cost,
  launching,
  error,
  onLaunch,
  focusNonce,
}: {
  medium: "image" | "speech";
  text: string;
  onText: (text: string) => void;
  models: MediaShotModel[];
  chosen: MediaShotModel[];
  onToggleModel: (model: MediaShotModel) => void;
  onBrowseModels: () => void;
  // The formats every chosen photo model takes.
  aspectRatios: string[];
  aspectRatio: string | null;
  onAspectRatio: (ratio: string) => void;
  voice: string | null;
  onVoice: (voice: string | null) => void;
  instructions: string;
  onInstructions: (text: string) => void;
  actors: ComposerActor[];
  actorId: string | null;
  onActor: (id: string | null) => void;
  count: number;
  onCount: (count: number) => void;
  // The launch's estimated cost, null when a chosen model lists no price.
  cost: number | null;
  launching: boolean;
  error: string | null;
  onLaunch: () => void;
  focusNonce: number;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusNonce === 0) return;
    const node = field.current;
    node?.focus();
    node?.setSelectionRange(node.value.length, node.value.length);
  }, [focusNonce]);

  const photo = medium === "image";
  const model = chosen[0];
  const voices = !photo ? (model?.voices ?? null) : null;
  const canLaunch = Boolean(chosen.length && text.trim() && (!photo || aspectRatio)) && !launching;
  const renders = photo ? chosen.length * count : 1;
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
        {photo ? "Describe the photo" : "What the voice says"}
      </label>
      <textarea
        id="shot-text"
        ref={field}
        rows={2}
        value={text}
        maxLength={4000}
        onChange={(event) => onText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (canLaunch) onLaunch();
          }
        }}
        placeholder={
          photo
            ? "Describe the photo: the subject, the place, the light, the lens…"
            : "Write what the voice says, word for word."
        }
        className="field-sizing-content block max-h-56 min-h-14 w-full resize-none bg-transparent px-1 py-1 text-[0.9375rem] leading-relaxed text-fg outline-none placeholder:text-muted/80"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ModelPicker
          models={models}
          value={chosen}
          onToggle={onToggleModel}
          onBrowse={onBrowseModels}
          max={photo ? 4 : 1}
        />

        {photo && aspectRatios.length ? (
          <fieldset className="flex flex-wrap items-center gap-1">
            <legend className="sr-only">Format</legend>
            {aspectRatios.map((ratio) => (
              <button
                key={ratio}
                type="button"
                aria-pressed={aspectRatio === ratio}
                onClick={() => onAspectRatio(ratio)}
                className={chipClass(aspectRatio === ratio, "font-mono", "sm")}
              >
                {ratio}
              </button>
            ))}
          </fieldset>
        ) : null}

        {!photo && voices ? (
          <ChipSelect
            label="Voice"
            value={voice ?? ""}
            options={[
              { value: "", label: "Its own voice" },
              ...voices.map((v) => ({
                value: v.id,
                label: [v.name, v.description, v.language].filter(Boolean).join(" · "),
              })),
            ]}
            onChange={(v) => onVoice(v || null)}
          />
        ) : null}

        <ChipSelect
          label="Actor"
          value={actorId ?? ""}
          options={[{ value: "", label: "No actor" }, ...actors.map((a) => ({ value: a.id, label: a.name }))]}
          onChange={(v) => onActor(v || null)}
        />

        {photo ? (
          <ChipSelect
            label={chosen.length > 1 ? "How many on each model" : "How many"}
            value={String(Math.min(count, counts.at(-1)!))}
            options={counts.map((n) => ({ value: String(n), label: chosen.length > 1 ? `×${n} each` : `×${n}` }))}
            onChange={(v) => onCount(Number(v))}
          />
        ) : null}

        <div className="ml-auto flex items-center gap-3">
          {cost != null ? (
            <span className="font-mono text-xs tabular-nums text-muted">${cost.toFixed(cost < 0.1 ? 3 : 2)} est.</span>
          ) : chosen.length ? (
            <span className="text-xs text-muted" title="A chosen model lists no price. Check it with its provider.">
              price unknown
            </span>
          ) : null}
          <Button type="submit" variant="primary" disabled={!canLaunch}>
            {launching ? (photo ? "Drawing…" : "Speaking…") : renders > 1 ? `Launch ${renders}` : "Launch"}
            <span className="max-sm:hidden" aria-hidden>
              <Kbd>⌘↵</Kbd>
            </span>
          </Button>
        </div>
      </div>

      {!photo && model?.instructions ? (
        <label className="mt-3 block">
          <span className="sr-only">Delivery</span>
          <input
            type="text"
            value={instructions}
            maxLength={500}
            onChange={(event) => onInstructions(event.target.value)}
            placeholder="Delivery (optional): warm and slow, a smile in the voice…"
            className="w-full rounded-lg bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted/80"
          />
        </label>
      ) : null}

      {chosen
        .filter((m) => !m.available && m.status !== "missing-credentials")
        .map((m) => (
          <p key={m.key} className="mt-3 text-sm text-warning">
            {m.statusDetail}
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
    <label className={chipClass(false, "relative max-w-[16rem]", "sm")}>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="max-w-full cursor-pointer appearance-none truncate bg-transparent pr-1 text-fg outline-none"
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
