"use client";

import { useId } from "react";

import { clock } from "../format";

interface Part {
  part: "hook" | "body" | "cta";
  startS?: number;
  summary: string;
}

interface Frame {
  atS: number;
  url: string;
  description?: string;
  text?: string;
}

const PART_LABELS = { hook: "Hook", body: "Body", cta: "Call to action" } as const;
const PART_TONES = { hook: "bg-primary/20 text-primary", body: "bg-surface text-muted", cta: "bg-success/15 text-success" } as const;

// Ticks every 1, 2, 5, 10, 15, 30 or 60 s: about six along the axis.
function tickStep(durationS: number): number {
  return [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((step) => durationS / step <= 7) ?? 900;
}

// The structure as bands from each part's start to the next one's. The
// hook's own seconds are known from the transcript: its band covers them,
// and what follows starts after.
export function bands(structure: readonly Part[], durationS: number, hookEndS?: number) {
  const hookEnd = hookEndS ? Math.min(hookEndS, durationS) : null;
  const timed = structure
    .filter((p) => p.startS !== undefined && !(hookEnd !== null && p.part === "hook"))
    .map((p) => ({ ...p, startS: hookEnd !== null ? Math.max(p.startS!, hookEnd) : p.startS! }))
    .sort((a, b) => a.startS - b.startS);
  const out = timed.map((p, i) => ({ part: p.part, summary: p.summary, startS: p.startS, endS: Math.min(durationS, timed[i + 1]?.startS ?? durationS) })).filter((b) => b.endS > b.startS);
  if (hookEnd !== null) out.unshift({ part: "hook", summary: structure.find((p) => p.part === "hook")?.summary ?? "The first seconds", startS: 0, endS: hookEnd });
  return out;
}

const pct = (s: number, durationS: number) => `${Math.min(100, Math.max(0, (s / durationS) * 100))}%`;

// The item on one time axis: its hook, body and call to action as bands,
// the pictures taken after each cut at their seconds, and a scrubber; every
// one of them seeks the player.
export function ItemTimeline({ durationS, structure, hookEndS, frames, currentS, onSeek }: { durationS: number; structure: readonly Part[]; hookEndS?: number; frames: readonly Frame[]; currentS: number; onSeek: (seconds: number) => void }) {
  const scrubId = useId();
  const parts = bands(structure, durationS, hookEndS);
  const step = tickStep(durationS);
  const ticks = Array.from({ length: Math.floor(durationS / step) + 1 }, (_, i) => i * step);
  return (
    <div role="group" aria-label="Timeline" className="space-y-1.5">
      <div className="relative">
        {parts.length > 0 ? (
          <ol aria-label="Structure" className="relative h-7">
            {parts.map((b) => (
              <li key={`${b.part}-${b.startS}`} className="absolute inset-y-0 px-px" style={{ left: pct(b.startS, durationS), width: pct(b.endS - b.startS, durationS) }}>
                <button
                  type="button"
                  onClick={() => onSeek(b.startS)}
                  title={b.summary}
                  aria-label={`${PART_LABELS[b.part]}, ${clock(b.startS)} to ${clock(b.endS)}: ${b.summary}`}
                  className={`flex size-full items-center overflow-hidden rounded-md px-2 text-left text-[11px] font-medium whitespace-nowrap transition-[filter] duration-150 hover:brightness-110 ${PART_TONES[b.part]}`}
                >
                  <span className="truncate">{PART_LABELS[b.part]}</span>
                </button>
              </li>
            ))}
          </ol>
        ) : null}

        {frames.length > 0 ? (
          <ol aria-label="Pictures" className="relative mt-1.5 h-16">
            {frames.map((f) => (
              <li key={f.atS} className="absolute top-0 -translate-x-1/2 hover:z-10 focus-within:z-10" style={{ left: `clamp(1.5rem, ${pct(f.atS, durationS)}, calc(100% - 1.5rem))` }}>
                <button type="button" onClick={() => onSeek(f.atS)} aria-label={`Picture at ${clock(f.atS)}${f.description ? `: ${f.description}` : ""}`} title={f.description} className="block rounded-md transition-transform duration-150 hover:scale-105 motion-reduce:transition-none">
                  {/* biome-ignore lint/performance/noImgElement: the browser edition has no next/image; these are pictures the studio already sized. */}
                  <img src={f.url} alt="" loading="lazy" decoding="async" className="h-16 w-11 rounded-md object-cover outline outline-1 -outline-offset-1 outline-[var(--picture-edge)]" />
                </button>
              </li>
            ))}
          </ol>
        ) : null}

        <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-fg/70 transition-[left] duration-150 ease-out motion-reduce:transition-none" style={{ left: pct(currentS, durationS) }} />
      </div>

      <label htmlFor={scrubId} className="sr-only">
        Position
      </label>
      <input
        id={scrubId}
        type="range"
        min={0}
        max={durationS}
        step={0.1}
        value={Math.min(currentS, durationS)}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-valuetext={`${clock(currentS)} of ${clock(durationS)}`}
        className="block h-5 w-full cursor-pointer accent-[var(--troupe-color-primary)]"
      />
      <div aria-hidden className="relative h-4 font-mono text-[11px] tabular-nums text-muted">
        {ticks.map((t) => (
          <span key={t} className={`absolute ${t === 0 ? "" : "-translate-x-1/2"}`} style={{ left: pct(t, durationS) }}>
            {clock(t)}
          </span>
        ))}
      </div>
    </div>
  );
}
