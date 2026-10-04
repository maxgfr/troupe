"use client";

// Named sections of the Benchmark Lab (hotspot découpe, c6) — the same recipe
// as export-sections and the monitor: pure views, one visual block each; the
// page owns queries and state and wires them together.
import { ErrorNote, SkeletonRows } from "~/app/_components/ui";

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
  if (runs.length === 0) {
    return (
      <p className="max-w-[72ch] text-sm text-muted">
        No comparisons yet. Save a short script, then choose Compare models on the project page. You need at least two available models.
      </p>
    );
  }
  return (
    <>
      <ul className="max-w-2xl space-y-2">
        {runs.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onOpen(r.id)}
              className={`flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-left text-sm transition-colors duration-150 ${
                activeRunId === r.id ? "border-primary bg-primary/15" : "border-muted/40 hover:border-muted"
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{r.brief}</span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                {r.entryCount} renders · winner {r.winnerLabel ?? "—"} ·{" "}
                {new Date(r.createdAt).toLocaleDateString()}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {hasOlder ? (
        <button
          type="button"
          onClick={onShowOlder}
          disabled={loadingOlder}
          className="mt-3 rounded-lg border border-muted/40 px-4 py-2 text-sm transition-colors duration-150 hover:border-muted disabled:opacity-50"
        >
          Show older runs
        </button>
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
    <form
      className="mt-4 flex max-w-xl items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onOpen();
      }}
    >
      <label className="flex-1 text-sm">
        <span className="mb-1 block font-medium">Run ID</span>
        <input
          value={runId}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Paste a benchmark run id…"
          className="w-full rounded-lg border border-muted/40 bg-bg px-3 py-2 font-mono text-sm outline-none transition-colors duration-150 focus:border-primary"
        />
      </label>
      <button
        type="submit"
        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-opacity duration-150 hover:opacity-90"
      >
        Open run
      </button>
    </form>
  );
}
