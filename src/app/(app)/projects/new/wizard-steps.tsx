"use client";

// One component per wizard step — pure views (choices in via props,
// decisions out via callbacks), same DOM as the previous inline blocks.

import { ModelPicker } from "./model-picker";
import type { ModelOptionView } from "../model-choice";
import { ActorPortrait } from "~/app/_components/actor-portrait";
import { EmptyState, ErrorNote, ProviderWarning, Skeleton, chipClass } from "~/app/_components/ui";
import { platformName } from "~/modules/studio/platforms";
import { useEdition } from "~/app/_components/edition";
import { LANGUAGES, PLATFORMS, type Format, type Language, type Platform } from "./wizard-state";

export function PlatformStep({
  platform,
  onPlatform,
}: {
  platform: Platform;
  onPlatform: (platform: Platform) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-3 text-xl font-semibold tracking-[-0.01em]">Where will it play?</legend>
      <div className="flex flex-wrap gap-2">
        {PLATFORMS.map((p) => (
          <label key={p} className={chipClass(platform === p, "", "lg")}>
            <input
              type="radio"
              name="platform"
              className="sr-only"
              checked={platform === p}
              onChange={() => onPlatform(p)}
            />
            {platformName(p)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// The frame's shape, drawn to scale.
function FormatGlyph({ format }: { format: Format }) {
  const [w, h] = format.split(":").map(Number) as [number, number];
  const scale = 18 / Math.max(w, h);
  return (
    <span aria-hidden className="flex size-6 items-center justify-center">
      <span className="rounded-[3px] shadow-[inset_0_0_0_1.5px_currentColor] text-muted" style={{ width: `${w * scale}px`, height: `${h * scale}px` }} />
    </span>
  );
}

export interface FormatOptionView {
  format: Format;
  preselected?: boolean;
  warning?: string | null;
}

export function FormatStep({
  pending,
  options,
  chosenFormat,
  platform,
  models,
  selectedModel,
  defaultModelKey,
  onFormat,
  onModel,
}: {
  pending: boolean;
  options: FormatOptionView[];
  chosenFormat: Format | null;
  platform: Platform;
  models: ModelOptionView[];
  selectedModel: string | null;
  defaultModelKey?: string | null;
  onFormat: (format: Format) => void;
  onModel: (modelKey: string) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-3 text-xl font-semibold tracking-[-0.01em]">Format and model</legend>
      {pending ? (
        <Skeleton className="h-12 w-full" />
      ) : (
        <div className="space-y-2">
          {options.map((option) => (
            <label
              key={option.format}
              className={`flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl px-4 text-sm transition-[background-color,box-shadow] duration-150 ${
                chosenFormat === option.format
                  ? "bg-primary/10 shadow-[inset_0_0_0_1.5px_var(--troupe-color-primary)]"
                  : "shadow-[inset_0_0_0_1px_var(--troupe-color-line)] hover:bg-fg/[0.04]"
              }`}
            >
              <span className="flex items-center gap-3">
                <FormatGlyph format={option.format} />
                <span className="font-mono tabular-nums">{option.format}</span>
              </span>
              <input
                type="radio"
                name="format"
                className="sr-only"
                checked={chosenFormat === option.format}
                onChange={() => onFormat(option.format)}
              />
              {option.preselected ? (
                <span className="text-xs text-muted">recommended for {platformName(platform)}</span>
              ) : null}
            </label>
          ))}
          {options
            .filter((o) => o.format === chosenFormat && o.warning)
            .map((o) => (
              <ProviderWarning key={o.format}>{o.warning}</ProviderWarning>
            ))}
          <ModelPicker options={models} value={selectedModel} defaultKey={defaultModelKey} onChange={onModel} />
        </div>
      )}
    </fieldset>
  );
}

export function LanguageStep({
  language,
  onLanguage,
  warnings = [],
}: {
  language: Language;
  onLanguage: (language: Language) => void;
  // What the chosen model says about this language.
  warnings?: string[];
}) {
  return (
    <fieldset>
      <legend className="mb-3 text-xl font-semibold tracking-[-0.01em]">Language</legend>
      <div className="flex flex-wrap gap-2">
        {LANGUAGES.map((l) => (
          <label key={l} className={chipClass(language === l, "font-mono uppercase", "lg")}>
            <input
              type="radio"
              name="language"
              className="sr-only"
              checked={language === l}
              onChange={() => onLanguage(l)}
            />
            {l}
          </label>
        ))}
      </div>
      <p className="mt-2 text-sm text-muted">
        Write your dialogue in this language. The model uses it to guide the voice.
      </p>
      {warnings.map((w) => <div key={w} className="mt-2"><ProviderWarning>{w}</ProviderWarning></div>)}
    </fieldset>
  );
}

export interface ActorView {
  id: string;
  name: string;
  style: string;
  ageRange: string;
  status: string;
  portraitUrl?: string | null;
}

export function ActorStep({
  pending,
  errorMessage,
  actors,
  actorId,
  onActor,
}: {
  pending: boolean;
  errorMessage?: string | null;
  actors: ActorView[];
  actorId: string | null;
  onActor: (actorId: string) => void;
}) {
  const restart = useEdition().kind === "browser" ? "reload this page" : "restart Troupe";
  return (
    <fieldset>
      <legend className="mb-3 text-xl font-semibold tracking-[-0.01em]">Who plays it?</legend>
      {pending ? (
        <Skeleton className="h-40 w-full" />
      ) : errorMessage ? (
        <ErrorNote>The actor library could not be loaded: {errorMessage}</ErrorNote>
      ) : actors.length === 0 ? (
        <EmptyState
          title="No actors in the library yet"
          body={`Troupe adds its 30 actor presets when the studio opens. If the list stays empty, ${restart}; your project choices are kept until you leave this page.`}
        />
      ) : actors.every((a) => a.status === "unavailable") ? (
        <ErrorNote>Every actor is unavailable because their portraits are missing. To restore the library, {restart}.</ErrorNote>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-3 sm:gap-4">
          {actors.map((actor) => (
            <label
              key={actor.id}
              className={`group relative cursor-pointer overflow-hidden rounded-xl transition-shadow duration-150 ${
                actorId === actor.id
                  ? "shadow-[0_0_0_2px_var(--troupe-color-background),0_0_0_4px_var(--troupe-color-primary)]"
                  : ""
              } ${actor.status === "unavailable" ? "cursor-not-allowed opacity-40" : ""}`}
            >
              <input
                type="radio"
                name="actor"
                className="sr-only"
                disabled={actor.status === "unavailable"}
                checked={actorId === actor.id}
                onChange={() => onActor(actor.id)}
              />
              <ActorPortrait
                id={actor.id}
                name={actor.name}
                src={actor.portraitUrl}
                label={`${actor.name} — ${actor.style}, ${actor.ageRange}`}
                sizes="(min-width: 640px) 170px, 45vw"
                className="aspect-[4/5] w-full transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
              />
              <span aria-hidden className="pointer-events-none absolute inset-0 rounded-xl shadow-[inset_0_0_0_1px_var(--picture-edge)]" />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-2.5 pt-8 pb-2 text-xs text-white">
                <strong className="font-semibold">{actor.name}</strong> <span className="text-white/75">· {actor.style}</span>
              </span>
              {actorId === actor.id ? (
                <span aria-hidden className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-primary text-on-primary shadow-card">
                  <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
                </span>
              ) : null}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
