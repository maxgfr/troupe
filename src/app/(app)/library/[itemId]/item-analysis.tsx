"use client";

import { clock } from "../format";

interface Analysis {
  language?: string | null;
  transcript?: { model: string; segments: { startS: number; endS: number; text: string }[] };
  frames?: { atS: number; url: string; description?: string; text?: string }[];
  hook?: { text: string; endS?: number; why?: string };
  structure?: { part: "hook" | "body" | "cta"; startS?: number; summary: string }[];
  pacing?: { wordsPerSecond?: number; cutsPerMinute?: number; pace: "slow" | "steady" | "fast" };
  tone?: string[];
  summary?: string;
  insightsModel?: string;
  steps: { name: string; status: "done" | "skipped" | "failed"; detail?: string }[];
}

const PART_LABELS = { hook: "Hook", body: "Body", cta: "Call to action" } as const;
const STEP_LABELS: Record<string, string> = {
  frames: "Pictures from the video",
  transcript: "Transcript",
  vision: "What the pictures show",
  insights: "Hook, structure and tags",
  embeddings: "Search by meaning",
};
const STEP_TONES = { done: "bg-success", skipped: "border border-warning", failed: "bg-danger" } as const;

// What the analysis found: the hook first, then what it is, how it is
// built, its pace, tone and tags; then the pictures and how it was read.
export function ItemAnalysis({
  analysis,
  tags,
  onSeek,
}: {
  analysis: Analysis;
  tags: string[];
  onSeek?: (seconds: number) => void;
}) {
  const seen = (analysis.frames ?? []).filter((f) => f.description || f.text);
  const facts: [string, React.ReactNode][] = [];
  if (analysis.pacing) {
    const p = analysis.pacing;
    facts.push([
      "Pace",
      <span key="pace" className="font-mono text-xs tabular-nums">
        {p.pace}
        {p.wordsPerSecond !== undefined ? ` · ${p.wordsPerSecond} words/s` : ""}
        {p.cutsPerMinute !== undefined ? ` · ${p.cutsPerMinute} cuts/min` : ""}
      </span>,
    ]);
  }
  if (analysis.tone?.length) facts.push(["Tone", analysis.tone.join(", ")]);
  if (analysis.language)
    facts.push([
      "Language",
      <span key="lang" className="font-mono text-xs uppercase">
        {analysis.language}
      </span>,
    ]);
  if (tags.length) {
    facts.push([
      "Tags",
      <span key="tags" className="flex flex-wrap gap-1">
        {tags.map((t) => (
          <span key={t} className="rounded-full bg-fg/[0.07] px-2 py-0.5 text-xs text-muted">
            {t}
          </span>
        ))}
      </span>,
    ]);
  }
  const time = (s: number | undefined) =>
    s === undefined ? null : onSeek ? (
      <button
        type="button"
        onClick={() => onSeek(s)}
        className="rounded font-mono text-xs tabular-nums text-primary underline-offset-4 hover:underline"
      >
        {clock(s)}
      </button>
    ) : (
      <span className="font-mono text-xs tabular-nums text-muted">{clock(s)}</span>
    );

  return (
    <div className="space-y-6">
      {analysis.hook ? (
        <figure className="space-y-1.5">
          <blockquote className="font-display text-pretty text-xl leading-snug font-semibold tracking-[-0.01em] sm:text-2xl">
            “{analysis.hook.text}”
          </blockquote>
          <figcaption className="max-w-[72ch] text-pretty text-sm text-muted">
            <span className="text-fg">The hook</span>
            {analysis.hook.endS ? (
              <>
                , <span className="font-mono text-xs tabular-nums">0:00–{clock(analysis.hook.endS)}</span>
              </>
            ) : null}
            {analysis.hook.why ? `. ${analysis.hook.why}` : "."}
          </figcaption>
        </figure>
      ) : null}

      {analysis.summary ? <p className="max-w-[72ch] text-pretty text-sm leading-relaxed">{analysis.summary}</p> : null}

      {analysis.structure?.length ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Structure</h3>
          <ol className="space-y-1.5 text-sm">
            {analysis.structure.map((p, i) => (
              <li
                key={i}
                className="grid grid-cols-[3rem_6.5rem_minmax(0,1fr)] items-baseline gap-2 max-sm:grid-cols-[3rem_minmax(0,1fr)]"
              >
                {/* The hook opens the item: its time is the start when the model left it out. */}
                <span>{time(p.startS ?? (p.part === "hook" && i === 0 ? 0 : undefined))}</span>
                <span className="text-xs font-medium text-muted max-sm:hidden">{PART_LABELS[p.part]}</span>
                <span className="text-pretty">
                  <span className="mr-1.5 text-xs font-medium text-muted sm:hidden">{PART_LABELS[p.part]}</span>
                  {p.summary}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {facts.length ? (
        <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-xs text-muted">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {seen.length ? (
        <details className="group">
          <summary className="cursor-pointer text-sm font-semibold marker:text-muted">
            What the pictures show <span className="font-normal text-muted">({seen.length})</span>
          </summary>
          <ul className="mt-3 space-y-3">
            {seen.map((f) => (
              <li key={f.atS} className="flex gap-3">
                {/* biome-ignore lint/performance/noImgElement: the browser edition has no next/image; these are pictures the studio already sized. */}
                <img
                  src={f.url}
                  alt=""
                  loading="lazy"
                  className="h-16 w-11 shrink-0 rounded-md object-cover outline outline-1 -outline-offset-1 outline-[var(--picture-edge)]"
                />
                <div className="min-w-0 space-y-0.5 text-sm">
                  <p>{time(f.atS)}</p>
                  {f.description ? <p className="text-pretty">{f.description}</p> : null}
                  {f.text ? <p className="text-pretty text-muted">On screen: “{f.text}”</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <details className="group">
        <summary className="cursor-pointer text-sm font-semibold marker:text-muted">How it was read</summary>
        <ul className="mt-3 space-y-2 text-sm">
          {analysis.steps.map((s) => (
            <li key={s.name} className="flex gap-2">
              <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${STEP_TONES[s.status]}`} />
              <span className="min-w-0">
                <span className="font-medium">{STEP_LABELS[s.name] ?? s.name}</span>
                <span className="text-muted">
                  {" "}
                  · {s.status === "done" ? "done" : s.status === "skipped" ? "skipped" : "failed"}
                </span>
                {s.detail ? <span className="block text-pretty text-muted">{s.detail}</span> : null}
              </span>
            </li>
          ))}
          {analysis.transcript ? (
            <li className="font-mono text-xs text-muted">Transcript: {analysis.transcript.model}</li>
          ) : null}
          {analysis.insightsModel ? (
            <li className="font-mono text-xs text-muted">Analysis: {analysis.insightsModel}</li>
          ) : null}
        </ul>
      </details>
    </div>
  );
}
