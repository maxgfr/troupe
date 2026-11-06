"use client";

import { useEffect, useRef, useState } from "react";

import { CheckIcon, ChevronDownIcon, SearchIcon } from "~/app/_components/icons";
import { chipClass, fieldClass } from "~/app/_components/ui";
import { MAX_MODELS, matchModels } from "./shot-settings";
import type { ShotModel } from "./types";

// The composer's models: a chip that opens a searchable list above it, where
// each model is ticked on or off. The shot renders on every ticked model,
// side by side in the gallery, up to MAX_MODELS. A model without its key
// stays choosable: ticking it asks for the key. The arrow keys move between
// the search and the models, Escape closes.
export function ModelPicker({
  models,
  value,
  onToggle,
  onBrowse,
}: {
  models: ShotModel[];
  value: ShotModel[];
  onToggle: (model: ShotModel) => void;
  // Opens fal.ai's catalog, to add a model the studio does not have yet.
  onBrowse?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const shown = matchModels(models, query);
  const chosen = new Set(value.map((m) => m.key));
  const full = chosen.size >= MAX_MODELS;

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery("");
    toggle.current?.focus();
  };

  // A model that needs its key opens the key dialog: the list makes way.
  const pick = (model: ShotModel) => {
    onToggle(model);
    if (!chosen.has(model.key) && model.status === "missing-credentials") close();
  };

  const blocked = (model: ShotModel) =>
    model.needsScript || (!chosen.has(model.key) && full) || (chosen.has(model.key) && chosen.size === 1);

  // From the search (index -1) or a model, to the next or previous one.
  const move = (event: React.KeyboardEvent, from: number) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const to = event.key === "ArrowDown" ? Math.min(from + 1, shown.length - 1) : from - 1;
    if (to < 0) search.current?.focus();
    else items.current[to]?.focus();
  };

  const first = value[0];
  const summary = !first ? "Choose a model" : value.length === 1 ? first.label : `${first.label} + ${value.length - 1}`;

  return (
    <div ref={root} className="relative">
      <button
        ref={toggle}
        type="button"
        aria-expanded={open}
        aria-label={`Models: ${value.map((m) => m.label).join(", ") || "none"}. Change the models`}
        onClick={() => (open ? close() : setOpen(true))}
        className={chipClass(true, "max-w-[18rem]", "sm")}
      >
        <span className="truncate">{summary}</span>
        <ChevronDownIcon className="size-3.5" />
      </button>
      {open ? (
        <div className="absolute bottom-full left-0 z-40 mb-2 w-[min(23rem,calc(100vw-2rem))] rounded-2xl bg-raised p-2 shadow-overlay">
          <label className="relative block">
            <span className="sr-only">Search the models</span>
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              ref={search}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && shown[0] && !blocked(shown[0])) {
                  event.preventDefault();
                  pick(shown[0]);
                } else move(event, -1);
              }}
              placeholder="Search the models"
              className={`${fieldClass} pl-9`}
            />
          </label>
          <p className="px-3 pt-2 text-xs text-muted">
            Tick up to {MAX_MODELS} models: the shot renders on each, side by side.
          </p>
          <ul aria-label="Models" className="mt-1 max-h-72 overflow-y-auto">
            {shown.length === 0 ? <li className="px-3 py-2 text-sm text-muted">No model matches.</li> : null}
            {shown.map((model, i) => {
              const selected = chosen.has(model.key);
              return (
                <li key={model.key}>
                  <button
                    ref={(node) => {
                      items.current[i] = node;
                    }}
                    type="button"
                    aria-pressed={selected}
                    disabled={blocked(model)}
                    onClick={() => pick(model)}
                    onKeyDown={(event) => move(event, i)}
                    className="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-fg/[0.06] focus-visible:bg-fg/[0.06] disabled:cursor-not-allowed"
                  >
                    <span
                      aria-hidden
                      className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded ${
                        selected
                          ? "bg-primary text-on-primary"
                          : "shadow-[inset_0_0_0_1.5px_var(--troupe-color-line-strong)]"
                      }`}
                    >
                      {selected ? <CheckIcon className="size-3" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block font-medium ${blocked(model) && !selected ? "text-muted" : ""}`}>
                        {model.label}
                      </span>
                      <span className="block text-xs text-muted">
                        {model.vendor}
                        {model.pricePerSecondUsd != null ? (
                          <span className="font-mono"> · ${model.pricePerSecondUsd.toFixed(2)}/s est.</span>
                        ) : null}
                      </span>
                      {model.available ? null : (
                        <span className={`mt-0.5 block text-xs ${model.needsScript ? "text-muted" : "text-warning"}`}>
                          {model.status === "missing-credentials" ? "Needs its API key" : model.unavailableReason}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {onBrowse ? (
            <button
              type="button"
              onClick={() => {
                close();
                onBrowse();
              }}
              className="mt-1 flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-medium text-primary shadow-[0_-1px_0_var(--troupe-color-line)] transition-colors duration-150 hover:bg-primary/10"
            >
              <SearchIcon className="size-4" />
              Browse fal.ai models
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
