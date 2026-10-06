import { ProviderWarning, SpotButton, StatusChip, fieldClass, panelClass } from "~/app/_components/ui";
import { vttFromLines } from "~/app/_components/captions";
import { formatCost } from "../projects/model-choice";
import { shownLength } from "../projects/[projectId]/generation-timeline";

export interface BenchmarkEntryView {
  id: string;
  modelKey: string;
  label?: string;
  status: string;
  costUsd?: number | null;
  costSource?: "estimate" | "provider" | null;
  latencyMs?: number | null;
  outputAssetUrl?: string | null;
  durationS?: number | null;
  mediaDurationS?: number | null;
  burnedCaptions?: boolean;
  votes?: Record<string, number>;
}

// Pure view — one column per model, same brief: cost and latency in mono,
// the vote is a gold decision. Adopting the winner is the
// second gold decision: it closes the benchmark→production loop.
export function BenchmarkCompare({
  entries,
  onVote,
  winnerEntryId,
  onAdopt,
  adoptWarning,
  brief,
  briefLines,
}: {
  entries: BenchmarkEntryView[];
  onVote?: (entryId: string, score: number) => void;
  winnerEntryId?: string | null;
  onAdopt?: (modelKey: string) => void;
  adoptWarning?: string | null;
  // The run's brief IS each render's spoken script — it captions every
  // preview. When the run carries its script lines, cues land per line; the
  // joined brief is the single-cue fallback.
  brief?: string | null;
  briefLines?: string[] | null;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
      {entries.map((entry) => (
        <div key={entry.id} className={`px-4 py-4 ${panelClass}`}>
          <div className="flex items-center justify-between">
            <p className="font-semibold">{entry.label ?? entry.modelKey}</p>
            <StatusChip status={entry.status} />
          </div>
          {entry.outputAssetUrl ? (
            // Capped like the project page's player: a 9:16 render must not
            // fill a column 900 px tall.
            <video controls playsInline src={entry.outputAssetUrl} className="mx-auto mt-3 max-h-[420px] rounded-xl bg-black">
              {briefLines?.length || brief ? (
                <track
                  kind="captions"
                  label="Script"
                  default={!entry.burnedCaptions}
                  src={vttFromLines(briefLines?.length ? briefLines : [brief!], entry.mediaDurationS ?? entry.durationS ?? 20)}
                />
              ) : null}
            </video>
          ) : (
            <div className="mt-3 flex aspect-video items-center justify-center rounded-xl bg-surface px-4 text-center text-xs text-muted">
              {entry.status === "failed" ? "This render failed: its project's Video tab says why." : "Rendering…"}
            </div>
          )}
          <dl className="mt-3 space-y-1 font-mono text-xs tabular-nums text-muted">
            {entry.mediaDurationS || entry.durationS ? (
              <div className="flex justify-between">
                <dt>length</dt>
                <dd>{shownLength({ durationS: entry.durationS ?? 0, mediaDurationS: entry.mediaDurationS })}</dd>
              </div>
            ) : null}
            <div className="flex justify-between">
              <dt>cost</dt>
              <dd>{formatCost(entry.costUsd, entry.costSource)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>latency</dt>
              <dd>{entry.latencyMs != null ? `${Math.round(entry.latencyMs / 1000)}s` : "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt>votes</dt>
              <dd>{Object.keys(entry.votes ?? {}).length}</dd>
            </div>
          </dl>
          {onVote ? (
            <div className="mt-3 space-y-2">
              <label className="block text-xs text-muted" htmlFor={`score-${entry.id}`}>Quality score</label>
              <select data-field disabled={entry.status !== "completed"} id={`score-${entry.id}`} className={fieldClass} value={Object.values(entry.votes ?? {})[0] ?? ""} onChange={(event) => onVote(entry.id, Number(event.target.value))}>
                <option value="" disabled>Rate this render</option>
                {[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score} / 5</option>)}
              </select>
            </div>
          ) : null}
          {onAdopt && winnerEntryId === entry.id && entry.status === "completed" ? (
            <>
              {adoptWarning ? <ProviderWarning>{adoptWarning}</ProviderWarning> : null}
              <SpotButton disabled={Boolean(adoptWarning)} className="mt-3 w-full" onClick={() => onAdopt(entry.modelKey)}>
                Adopt for project
              </SpotButton>
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
}

