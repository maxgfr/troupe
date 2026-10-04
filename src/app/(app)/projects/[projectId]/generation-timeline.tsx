import { useEdition } from "~/app/_components/edition";
import { EmptyState, StatusChip } from "~/app/_components/ui";
import { spokenLinesFromPrompt, vttFromLines } from "~/app/_components/captions";
import { formatCost } from "../model-choice";

export interface GenerationRow {
  id: string;
  provider: string;
  modelId: string;
  modelKey?: string;
  // The model's own id for the job, once it accepted it.
  providerJobId?: string | null;
  modelLabel?: string | null;
  tier: "draft" | "final";
  status: "queued" | "in_progress" | "completed" | "failed";
  durationS: number;
  createdAt: string | Date;
  outputAssetUrl?: string | null;
  errorCode?: string | null;
  errorDetail?: string | null;
  costUsd?: string | number | null;
  costSource?: "estimate" | "provider" | null;
  // Compiled prompt — its Dialogue section captions the preview.
  prompt?: string | null;
}

export const TIMEOUT_MESSAGE = "The model did not finish before its time limit. Check it before retrying.";

function failureMessage(g: GenerationRow): string | null {
  if (g.errorCode === "DOWNLOAD_RETRY") return "Saving the video — retrying the download.";
  if (g.status !== "failed") return null;
  if (g.errorCode === "RECONCILE_TIMEOUT") return TIMEOUT_MESSAGE;
  if (g.errorDetail) return g.errorDetail;
  if (g.errorCode === "SUBMISSION_UNKNOWN") return "Submission could not be confirmed. Check your provider dashboard before retrying to avoid a second charge.";
  return "The render failed. Check the model in Settings and try again.";
}

// Pure view — the launch timeline. The newest completed render is the star:
// video on bare bg, no card around it; the rest is a quiet filmstrip.
export function GenerationTimeline({ generations, onRelaunch }: { generations: GenerationRow[]; onRelaunch?: (generationId: string) => void }) {
  const edition = useEdition();
  const rendering = edition.kind === "demo" ? edition.rendering : undefined;
  if (generations.length === 0) {
    return (
      <EmptyState
        title="No render yet — the stage is lit"
        body={rendering ? "Launch a draft below. It renders in this tab and plays here when it is done." : "Launch a draft below and follow its progress here."}
      />
    );
  }
  const star = generations.find((g) => g.status === "completed");
  return (
    <div className="space-y-6">
      {star?.outputAssetUrl ? (
        <video
          controls
          src={star.outputAssetUrl}
          className="mx-auto max-h-[420px] rounded-xl"
          aria-label={`Latest completed render — ${star.tier} by ${star.modelLabel ?? star.provider}`}
        >
          {(() => {
            // One cue per dialogue line, prorated over the clip.
            const spoken = star.prompt ? spokenLinesFromPrompt(star.prompt) : null;
            return spoken ? (
              <track kind="captions" label="Script" default src={vttFromLines(spoken, star.durationS)} />
            ) : null;
          })()}
        </video>
      ) : null}
      {/* Job progress is announced to assistive tech as it changes. */}
      <ul aria-live="polite" className="space-y-2">
        {generations.map((g) => {
          const failure = failureMessage(g);
          const cost = g.costUsd == null ? null : Number(g.costUsd);
          return (
            <li
              key={g.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface px-4 py-2.5"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <StatusChip status={g.status} />
                <span className="truncate font-mono text-xs text-muted">
                  {g.tier} · {g.modelLabel ?? `${g.provider}/${g.modelId}`} · {g.durationS}s
                  {cost !== null ? ` · ${formatCost(cost, g.costSource)}` : ""}
                </span>
                {failure ? <span className="text-xs text-warning">{failure}</span> : null}
              </div>
              {g.outputAssetUrl ? <a href={`${g.outputAssetUrl}?download=1`} className="text-sm text-primary hover:underline">Download MP4</a> : null}
              {g.status === "failed" && onRelaunch ? (
                <button type="button" onClick={() => onRelaunch(g.id)} className="rounded-lg border border-muted/30 px-3 py-1 text-xs">Relaunch</button>
              ) : null}
              {g.status === "in_progress" && rendering && g.modelKey === rendering.modelKey && g.providerJobId ? (
                <rendering.Progress providerJobId={g.providerJobId} />
              ) : g.status === "in_progress" ? (
                <span
                  aria-hidden
                  className="progress-glow h-1.5 w-24 overflow-hidden rounded-full bg-primary/30"
                >
                  <span className="block h-full w-1/2 rounded-full bg-primary" />
                </span>
              ) : (
                <span className="font-mono text-xs text-muted">
                  {new Date(g.createdAt).toLocaleTimeString()}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
