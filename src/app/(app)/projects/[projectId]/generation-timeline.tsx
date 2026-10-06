import { useEdition } from "~/app/_components/edition";
import { DownloadIcon, FilmIcon, PlayIcon } from "~/app/_components/icons";
import { VideoStill } from "~/app/_components/video-still";
import { Button, ButtonLink, EmptyState, ProgressBar, StatusChip, buttonClass } from "~/app/_components/ui";
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
  if (g.errorCode === "SUBMISSION_UNKNOWN")
    return "Submission could not be confirmed. Check your provider dashboard before retrying to avoid a second charge.";
  return "The render failed. Check the model in Settings and try again.";
}

// The video's length once it is saved (a model may make it longer or
// shorter than the clip asked for), else the clip length asked for.
export function shownLength(g: Pick<GenerationRow, "durationS" | "mediaDurationS">): string {
  if (g.mediaDurationS) return `${(Math.round(g.mediaDurationS * 10) / 10).toFixed(1)} s`;
  return `${g.durationS} s`;
}

const THUMB = "h-14 w-10 shrink-0 rounded-md";

// A render's glyph tile: a film for one without a video yet, a play mark for
// the one already on the stage above (no second fetch of its video).
function RenderGlyph({ g, playing = false }: { g: GenerationRow; playing?: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex items-center justify-center ${THUMB} ${playing ? "bg-primary/15 text-primary" : g.status === "failed" ? "bg-danger/10 text-danger" : "bg-fg/[0.06] text-muted"}`}
    >
      {playing ? <PlayIcon className="size-4 translate-x-px" /> : <FilmIcon className="size-4" />}
    </span>
  );
}

// A finished render's first moments, as a small still in its row.
function RenderThumb({ g, playing }: { g: GenerationRow; playing: boolean }) {
  if (playing || g.status !== "completed" || !g.outputAssetUrl) return <RenderGlyph g={g} playing={playing} />;
  return (
    <VideoStill
      src={g.outputAssetUrl}
      fallback={<RenderGlyph g={g} />}
      className={`${THUMB} shadow-[inset_0_0_0_1px_var(--picture-edge)]`}
    />
  );
}

// Pure view — the launch timeline. The newest completed render is the star:
// the video large on the stage, glowing in the actor's hue, no card around
// it; every render below is a row with its still, its state and its figures.
export function GenerationTimeline({
  generations,
  projectId,
  projectTitle,
  onRelaunch,
  glowHue = null,
}: {
  generations: GenerationRow[];
  projectId?: string;
  projectTitle?: string | null;
  onRelaunch?: (generationId: string) => void;
  // The project's actor's hue, for the glow under the newest video.
  glowHue?: number | null;
}) {
  const edition = useEdition();
  const rendering = edition.kind === "browser" ? edition.rendering : undefined;
  if (generations.length === 0) {
    return (
      <EmptyState
        title="No render yet — the stage is lit"
        body={
          rendering
            ? "Launch a draft below. It renders in this tab and plays here when it is done."
            : "Launch a draft below and follow its progress here."
        }
      />
    );
  }
  const star = generations.find((g) => g.status === "completed");
  const fileName = (g: GenerationRow) =>
    renderFileName({ project: projectTitle, model: g.modelLabel ?? g.modelId, createdAt: g.createdAt });
  const glow = `0 30px 90px -30px oklch(0.55 0.13 ${glowHue ?? 250} / 0.55), var(--troupe-shadow-card)`;
  return (
    <div className="space-y-10">
      {star?.outputAssetUrl ? (
        <figure className="space-y-4">
          <video
            controls
            playsInline
            src={star.outputAssetUrl}
            className="mx-auto max-h-[min(72dvh,560px)] rounded-2xl bg-black"
            style={{ boxShadow: glow }}
            aria-label={`Latest completed render — ${star.tier} by ${star.modelLabel ?? star.provider}`}
          >
            {(() => {
              // One cue per dialogue line, prorated over the clip. A video
              // that shows its own captions keeps this track off by default.
              const spoken = star.prompt ? spokenLinesFromPrompt(star.prompt) : null;
              return spoken ? (
                <track
                  kind="captions"
                  label="Script"
                  default={!star.burnedCaptions}
                  src={vttFromLines(spoken, star.mediaDurationS ?? star.durationS)}
                />
              ) : null;
            })()}
          </video>
          {projectId ? (
            <figcaption className="flex flex-wrap items-center justify-center gap-2 text-sm">
              <ButtonLink href={`/projects/${projectId}/export?render=${star.id}`} variant="outline">
                Export this video
              </ButtonLink>
              <span className="text-xs text-muted">
                {star.burnedCaptions ? "Captions are part of the picture." : "Captions come from the script."}
              </span>
            </figcaption>
          ) : null}
        </figure>
      ) : null}
      <section aria-labelledby="renders-title" className="space-y-3">
        <h2 id="renders-title" className="flex items-baseline gap-2 text-xl font-semibold tracking-[-0.01em]">
          Renders <span className="font-mono text-sm font-normal tabular-nums text-muted">{generations.length}</span>
        </h2>
        {/* Job progress is announced to assistive tech as it changes. */}
        <ul aria-live="polite" className="divide-y divide-line">
          {generations.map((g) => {
            const failure = failureMessage(g);
            const cost = g.costUsd == null ? null : Number(g.costUsd);
            const running = g.status === "in_progress" || g.status === "queued";
            return (
              <li
                key={g.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <RenderThumb g={g} playing={g.id === star?.id && Boolean(star.outputAssetUrl)} />
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <StatusChip status={g.status} />
                      {/* Whole on phones (it wraps), on one line from the small breakpoint. */}
                      <span className="min-w-0 font-mono text-xs tabular-nums text-muted [overflow-wrap:anywhere] sm:truncate">
                        <span className={g.tier === "final" ? "text-success" : undefined}>
                          {g.tier === "final" ? "final" : "draft"}
                        </span>
                        {" · "}
                        {g.modelLabel ?? `${g.provider}/${g.modelId}`} · {shownLength(g)}
                        {cost !== null ? ` · ${formatCost(cost, g.costSource)}` : ""}
                      </span>
                    </div>
                    {failure ? <p className="text-pretty text-xs text-warning">{failure}</p> : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-13 sm:pl-0">
                  {g.outputAssetUrl ? (
                    <a
                      href={downloadUrl(g.outputAssetUrl, fileName(g))}
                      className={buttonClass({ variant: "quiet", size: "sm" })}
                    >
                      <DownloadIcon className="size-4" />
                      Download MP4
                    </a>
                  ) : null}
                  {g.status === "failed" && g.relaunched ? (
                    <span className="text-xs text-muted">Relaunched</span>
                  ) : null}
                  {g.status === "failed" && onRelaunch && !g.relaunched ? (
                    <Button size="sm" onClick={() => onRelaunch(g.id)}>
                      Relaunch
                    </Button>
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
      </section>
    </div>
  );
}
