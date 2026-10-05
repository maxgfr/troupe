import Link from "next/link";

import { useEdition } from "~/app/_components/edition";
import { EmptyState, ProgressBar, StatusChip } from "~/app/_components/ui";
import { spokenLinesFromPrompt, vttFromLines } from "~/app/_components/captions";
import { downloadUrl, renderFileName } from "~/app/_components/download-name";
import { formatCost } from "../model-choice";

export interface GenerationRow {
  id: string;
  provider: string;
  modelId: string;
  modelKey?: string;
  // The model's own id for the job, once it accepted it.
  providerJobId?: string | null;
  modelLabel?: string | null;
  // A render is a draft until it is exported; the exported one is final.
  tier: "draft" | "final";
  status: "queued" | "in_progress" | "completed" | "failed";
  // The clip length asked for at launch.
  durationS: number;
  // The saved video's real length, once it is saved.
  mediaDurationS?: number | null;
  // How far along the model said the job is (0–1), while it runs.
  progress?: number | null;
  // The model drew the captions into the picture.
  burnedCaptions?: boolean;
  // A newer render already tried this failed one again.
  relaunched?: boolean;
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

// The video's length once it is saved (a model may make it longer or
// shorter than the clip asked for), else the clip length asked for.
export function shownLength(g: Pick<GenerationRow, "durationS" | "mediaDurationS">): string {
  if (g.mediaDurationS) return `${(Math.round(g.mediaDurationS * 10) / 10).toFixed(1)} s`;
  return `${g.durationS} s`;
}

// Pure view — the launch timeline. The newest completed render is the star:
// video on bare bg, no card around it; the rest is a quiet filmstrip.
export function GenerationTimeline({ generations, projectId, projectTitle, onRelaunch }: {
  generations: GenerationRow[];
  projectId?: string;
  projectTitle?: string | null;
  onRelaunch?: (generationId: string) => void;
}) {
  const edition = useEdition();
  const rendering = edition.kind === "browser" ? edition.rendering : undefined;
  if (generations.length === 0) {
    return (
      <EmptyState
        title="No render yet — the stage is lit"
        body={rendering ? "Launch a draft below. It renders in this tab and plays here when it is done." : "Launch a draft below and follow its progress here."}
      />
    );
  }
  const star = generations.find((g) => g.status === "completed");
  const fileName = (g: GenerationRow) => renderFileName({ project: projectTitle, model: g.modelLabel ?? g.modelId, createdAt: g.createdAt });
  return (
    <div className="space-y-6">
      {star?.outputAssetUrl ? (
        <figure className="space-y-3">
          <video
            controls
            src={star.outputAssetUrl}
            className="mx-auto max-h-[420px] rounded-xl"
            aria-label={`Latest completed render — ${star.tier} by ${star.modelLabel ?? star.provider}`}
          >
            {(() => {
              // One cue per dialogue line, prorated over the clip. A video
              // that shows its own captions keeps this track off by default.
              const spoken = star.prompt ? spokenLinesFromPrompt(star.prompt) : null;
              return spoken ? (
                <track kind="captions" label="Script" default={!star.burnedCaptions} src={vttFromLines(spoken, star.mediaDurationS ?? star.durationS)} />
              ) : null;
            })()}
          </video>
          {projectId ? (
            <figcaption className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm">
              <Link href={`/projects/${projectId}/export?render=${star.id}`} className="inline-flex min-h-10 items-center text-primary underline-offset-4 hover:underline">
                Export this video
              </Link>
              <span className="text-xs text-muted">{star.burnedCaptions ? "Captions are part of the picture." : "Captions come from the script."}</span>
            </figcaption>
          ) : null}
        </figure>
      ) : null}
      {/* Job progress is announced to assistive tech as it changes. */}
      <ul aria-live="polite" className="space-y-2">
        {generations.map((g) => {
          const failure = failureMessage(g);
          const cost = g.costUsd == null ? null : Number(g.costUsd);
          const running = g.status === "in_progress" || g.status === "queued";
          return (
            <li
              key={g.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg bg-surface px-4 py-2.5"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <StatusChip status={g.status} />
                <span className="min-w-0 truncate font-mono text-xs tabular-nums text-muted">
                  <span className={g.tier === "final" ? "text-success" : undefined}>{g.tier === "final" ? "final" : "draft"}</span>
                  {" · "}{g.modelLabel ?? `${g.provider}/${g.modelId}`} · {shownLength(g)}
                  {cost !== null ? ` · ${formatCost(cost, g.costSource)}` : ""}
                </span>
                {failure ? <span className="text-xs text-warning">{failure}</span> : null}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {g.outputAssetUrl ? (
                  <a href={downloadUrl(g.outputAssetUrl, fileName(g))} className="-my-2 inline-flex min-h-10 items-center text-sm text-primary underline-offset-4 hover:underline">
                    Download MP4
                  </a>
                ) : null}
                {g.status === "failed" && g.relaunched ? <span className="text-xs text-muted">Relaunched</span> : null}
                {g.status === "failed" && onRelaunch && !g.relaunched ? (
                  <button type="button" onClick={() => onRelaunch(g.id)} className="min-h-9 rounded-lg border border-muted/30 px-3 text-xs transition-colors duration-150 hover:border-muted/60">Relaunch</button>
                ) : null}
                {g.status === "in_progress" && rendering && g.modelKey === rendering.modelKey && g.providerJobId ? (
                  <rendering.Progress providerJobId={g.providerJobId} />
                ) : running ? (
                  <ProgressBar
                    label={g.status === "queued" ? "Waiting for the model" : "Progress"}
                    figure={g.progress != null ? `${Math.round(g.progress * 100)}%` : null}
                    fraction={g.progress ?? null}
                  />
                ) : (
                  <span className="font-mono text-xs tabular-nums text-muted">
                    {new Date(g.createdAt).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
