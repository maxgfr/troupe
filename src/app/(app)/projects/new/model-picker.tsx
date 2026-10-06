"use client";

import Link from "next/link";

import { ProviderWarning } from "~/app/_components/ui";
import type { ModelOptionView } from "../model-choice";

// Choose a video model. Models that cannot render this project stay visible
// but disabled, with the reason; the chosen one shows what to expect.
export function ModelPicker(props: {
  options: ModelOptionView[];
  value: string | null;
  defaultKey?: string | null;
  onChange: (modelKey: string) => void;
}) {
  if (props.options.length === 0) {
    return (
      <ProviderWarning>
        No video model is configured yet.{" "}
        <Link href="/settings" className="underline">
          Add an API key or a local model in Settings
        </Link>
        .
      </ProviderWarning>
    );
  }
  const selected = props.options.find((o) => o.key === props.value);
  return (
    <fieldset>
      <legend className="mt-4 mb-2 text-sm font-medium">Video model</legend>
      <div className="space-y-2">
        {props.options.map((option) => {
          const disabled = !option.available || !option.compatible;
          return (
            <label
              key={option.key}
              className={`flex min-h-12 items-center justify-between gap-3 rounded-xl px-4 py-2.5 text-sm transition-[background-color,box-shadow] duration-150 ${
                disabled
                  ? "cursor-not-allowed opacity-60 shadow-[inset_0_0_0_1px_var(--troupe-color-line)]"
                  : "cursor-pointer"
              } ${props.value === option.key ? "bg-primary/10 shadow-[inset_0_0_0_1.5px_var(--troupe-color-primary)]" : disabled ? "" : "shadow-[inset_0_0_0_1px_var(--troupe-color-line)] hover:bg-fg/[0.04]"}`}
            >
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{option.label}</span>
                <span className="text-xs text-muted">{option.vendor}</span>
                {option.key === props.defaultKey ? <span className="text-xs text-muted">· default</span> : null}
                {!option.available ? (
                  <span className="w-full text-xs text-muted">{option.unavailableReason}</span>
                ) : null}
                {option.available && !option.compatible ? (
                  <span className="w-full text-xs text-muted">{option.warnings[0]}</span>
                ) : null}
              </span>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${option.kind === "local" ? "bg-success/15 text-success" : "bg-fg/[0.07] text-muted"}`}
              >
                {option.kind}
              </span>
              <input
                type="radio"
                name="model"
                className="sr-only"
                aria-label={`${option.label} ${option.vendor}`}
                disabled={disabled}
                checked={props.value === option.key}
                onChange={() => props.onChange(option.key)}
              />
            </label>
          );
        })}
      </div>
      {selected?.compatible
        ? selected.warnings.map((w) => (
            <div key={w} className="mt-2">
              <ProviderWarning>{w}</ProviderWarning>
            </div>
          ))
        : null}
    </fieldset>
  );
}
