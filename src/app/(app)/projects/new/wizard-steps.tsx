"use client";

// One component per wizard step — pure views (choices in via props,
// decisions out via callbacks), same DOM as the previous inline blocks.

import { ModelPicker } from "./model-picker";
import type { ModelOptionView } from "../model-choice";
import { ActorPortrait } from "~/app/_components/actor-portrait";
import { EmptyState, ErrorNote, ProviderWarning, Skeleton } from "~/app/_components/ui";
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
      <legend className="mb-2 text-sm font-medium">Platform</legend>
      <div className="flex flex-wrap gap-2">
        {PLATFORMS.map((p) => (
          <label
            key={p}
            className={`cursor-pointer rounded-lg border px-4 py-2 text-sm transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary ${
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
              onChange={() => onPlatform(p)}
            />
            {platformName(p)}
          </label>
        ))}
      </div>
    </fieldset>
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
      <legend className="mb-2 text-sm font-medium">Format</legend>
      {pending ? (
        <Skeleton className="h-12 w-full" />
      ) : (
        <div className="space-y-2">
          {options.map((option) => (
            <label
              key={option.format}
              className={`flex cursor-pointer items-center justify-between rounded-lg border px-4 py-2.5 text-sm transition-colors duration-150 ${
                chosenFormat === option.format
                  ? "border-primary bg-primary/15"
                  : "border-muted/40 hover:border-muted"
              }`}
            >
              <span className="font-mono">{option.format}</span>
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
      <legend className="mb-2 text-sm font-medium">Language</legend>
      <div className="flex flex-wrap gap-2">
        {LANGUAGES.map((l) => (
          <label
            key={l}
            className={`cursor-pointer rounded-lg border px-4 py-2 font-mono text-sm uppercase transition-colors duration-150 ${
              language === l
                ? "border-primary bg-primary/15 font-medium text-primary"
                : "border-muted/40 text-muted hover:text-fg"
            }`}
          >
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
  const restart = useEdition().kind === "demo" ? "reload this page" : "restart Troupe";
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">Actor</legend>
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
        <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
          {actors.map((actor) => (
            <label
              key={actor.id}
              className={`cursor-pointer overflow-hidden rounded-xl border transition-colors duration-150 ${
                actorId === actor.id
                  ? "border-primary ring-2 ring-primary"
                  : "border-muted/30 hover:border-muted"
              } ${actor.status === "unavailable" ? "opacity-40" : ""}`}
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
                label={`${actor.name} — ${actor.style}, ${actor.ageRange}`}
                className="aspect-square w-full"
              />
              <span className="block px-2 py-1.5 text-xs">
                <strong>{actor.name}</strong> <span className="text-muted">· {actor.style}</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
