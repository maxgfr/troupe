"use client";

// Named sections of the Benchmark Lab (hotspot découpe, c6) — the same recipe
// as export-sections and the monitor: pure views, one visual block each; the
// page owns queries and state and wires them together.
import { Button, ErrorNote, SkeletonRows, fieldClass } from "~/app/_components/ui";

export interface RunSummaryView {
  id: string;
  brief: string;
  createdAt: string | Date;
  entryCount: number;
  winnerLabel: string | null;
}

export function RunListSection({
  pending,
  errorMessage,
  runs,
  activeRunId,
  onOpen,
  hasOlder,
  loadingOlder,
  onShowOlder,
}: {
  pending: boolean;
  errorMessage: string | null;
  runs: RunSummaryView[];
  activeRunId: string | null;
  onOpen: (runId: string) => void;
  hasOlder: boolean;
  loadingOlder: boolean;
  onShowOlder: () => void;
}) {
  if (pending) return <SkeletonRows rows={2} />;
  if (errorMessage) return <ErrorNote>The run list failed to load: {errorMessage}</ErrorNote>;
  // With none yet, the empty state below says how to start one.
  if (runs.length === 0) return null;
  return (
    <>
      <ul className="max-w-3xl divide-y divide-line overflow-hidden rounded-2xl shadow-[inset_0_0_0_1px_var(--troupe-color-line)]">
        {runs.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onOpen(r.id)}
              aria-pressed={activeRunId === r.id}
              className={`flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors duration-150 ${
                activeRunId === r.id ? "bg-primary/10 text-fg" : "hover:bg-fg/[0.04]"
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{r.brief}</span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                {r.entryCount} renders · winner {r.winnerLabel ?? "—"} · {new Date(r.createdAt).toLocaleDateString()}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {hasOlder ? (
        <Button onClick={onShowOlder} disabled={loadingOlder} className="mt-3">
          Show older comparisons
        </Button>
      ) : null}
    </>
  );
}

export function OpenRunForm({
  runId,
  onChange,
  onOpen,
}: {
  runId: string;
  onChange: (value: string) => void;
  onOpen: () => void;
}) {
  return (
    // A link from elsewhere (a CLI, a note) names a comparison by its id;
    // the list above is the usual way in.
    <details className="mt-4 max-w-xl text-sm">
      <summary className="inline-flex min-h-9 cursor-pointer items-center text-muted transition-colors duration-150 hover:text-fg">
        Open a comparison by its id
      </summary>
      <form
        className="mt-2 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onOpen();
        }}
      >
        <label className="flex-1 text-sm">
          <span className="sr-only">Comparison id</span>
          <input
            value={runId}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Paste its id…"
            className={`${fieldClass} font-mono`}
          />
        </label>
        <Button type="submit">Open</Button>
      </form>
    </details>
  );
}
