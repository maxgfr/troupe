"use client";

import Link from "next/link";

import { diffLines, type LineChange } from "~/modules/chat/diff";
import type { Proposal } from "~/modules/chat";
import { ProviderWarning, SpotButton } from "~/app/_components/ui";
import { estimateSeconds } from "./script/estimate";
import type { RelaunchPlan } from "./chat-launch";

type Line = Proposal["lines"][number];

const MARK: Record<LineChange["kind"], { sign: string; label: string; row: string; tone: string }> = {
  added: { sign: "+", label: "Added", row: "bg-success/10", tone: "text-success" },
  removed: { sign: "−", label: "Removed", row: "", tone: "text-danger" },
  changed: { sign: "~", label: "Changed", row: "bg-primary/10", tone: "text-primary" },
  same: { sign: "", label: "Unchanged", row: "", tone: "text-muted" },
};

function Direction({ line, before }: { line: Line; before?: Line }) {
  const retagged = before && before.emotion !== line.emotion;
  const recast = before && before.role !== line.role;
  return (
    <p className="mt-0.5 font-mono text-[11px] text-muted">
      {recast ? <><s>{before.role}</s> </> : null}
      {line.role} · {retagged ? <><s>{before.emotion}</s> </> : null}
      <span className={retagged ? "text-fg" : undefined}>{line.emotion}</span>
    </p>
  );
}

// The proposed lines against the current version, one row per line.
export function ProposalDiff({ current, proposed }: { current: readonly Line[]; proposed: readonly Line[] }) {
  const changes = diffLines(current, proposed);
  return (
    <ol className="space-y-0.5">
      {changes.map((change, i) => {
        const mark = MARK[change.kind];
        const line = change.kind === "changed" ? change.after : change.line;
        const before = change.kind === "changed" ? change.before : undefined;
        return (
          <li key={i} className={`grid grid-cols-[0.75rem_minmax(0,1fr)] gap-x-2 rounded-md px-2 py-1.5 ${mark.row}`}>
            <span aria-hidden className={`font-mono text-sm leading-5 ${mark.tone}`}>{mark.sign}</span>
            <div className="min-w-0">
              <span className="sr-only">{mark.label}: </span>
              <p className={`text-pretty text-sm leading-5 ${change.kind === "removed" ? "text-muted line-through decoration-danger/60" : change.kind === "same" ? "text-muted" : "text-fg"}`}>{line.text}</p>
              {before && before.text.trim() !== line.text.trim() ? (
                <p className="mt-0.5 text-pretty text-xs text-muted line-through decoration-muted/60">
                  <span className="sr-only">Was: </span>
                  {before.text}
                </p>
              ) : null}
              <Direction line={line} before={before} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export interface ProposalState {
  // The version it was asked on, and the version it made once applied.
  baseVersion: number | null;
  appliedVersion: number | null;
  latestVersion: number | null;
  // The newest pending proposal carries the decision (gold).
  newest: boolean;
}

export function ProposalCard({
  projectId,
  proposal,
  current,
  state,
  clipS,
  actorChange,
  relaunch,
  busy,
  onApply,
  onApplyAndLaunch,
}: {
  projectId: string;
  proposal: Proposal;
  current: readonly Line[];
  state: ProposalState;
  clipS: number;
  actorChange: { from: string; to: string } | null;
  relaunch: RelaunchPlan;
  busy: boolean;
  onApply: () => void;
  onApplyAndLaunch: () => void;
}) {
  const estimatedS = estimateSeconds(proposal.lines.map((l) => l.text).join(" "));
  const words = proposal.lines.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0);
  const applied = state.appliedVersion !== null;
  const outdated = !applied && state.baseVersion !== state.latestVersion;
  const unchanged = !actorChange && diffLines(current, proposal.lines).every((c) => c.kind === "same");

  return (
    <div className="rounded-xl border border-muted/25">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-muted/20 px-3 py-2">
        <p className="text-xs font-medium">
          {applied ? `Applied as version ${state.appliedVersion}` : state.latestVersion ? `Compared with version ${state.latestVersion}` : "First script"}
        </p>
        <p className={`font-mono text-xs tabular-nums ${estimatedS > clipS ? "text-warning" : "text-muted"}`}>
          {words} words · ≈{estimatedS} s of {clipS} s
        </p>
      </div>
      <div className="space-y-2 p-2">
        <ProposalDiff current={current} proposed={proposal.lines} />
        {actorChange ? (
          <p className="px-2 text-sm">
            <span className="text-muted">Actor:</span> <s className="text-muted">{actorChange.from}</s> {actorChange.to}
          </p>
        ) : null}
        {applied ? (
          <p className="px-2 pb-1 text-xs text-muted">
            <span className="text-success">Applied.</span>{" "}
            <Link href={`/projects/${projectId}/script`} className="text-primary underline-offset-4 hover:underline">
              Open the script
            </Link>
          </p>
        ) : (
          <>
            {outdated && state.latestVersion !== null ? (
              <ProviderWarning>
                {state.baseVersion === null
                  ? `Asked before the script had a version. Applying adds these lines as version ${state.latestVersion + 1}.`
                  : `Asked on version ${state.baseVersion}; the script has since changed to version ${state.latestVersion}. Applying adds these lines as version ${state.latestVersion + 1}, without version ${state.latestVersion}'s changes.`}
              </ProviderWarning>
            ) : null}
            {estimatedS > clipS ? (
              <p className="px-2 text-xs text-muted">Longer than the {clipS} s clip. Ask for a shorter version, or relaunch on a longer clip.</p>
            ) : null}
            {unchanged ? <p className="px-2 pb-1 text-xs text-muted">Same lines as the current version: nothing to apply.</p> : (
              <div className="flex flex-wrap items-center gap-2 px-1 pb-1">
                {relaunch.ok ? (
                  state.newest ? (
                    <SpotButton type="button" disabled={busy} onClick={onApplyAndLaunch}>
                      Apply &amp; relaunch
                    </SpotButton>
                  ) : (
                    <button type="button" disabled={busy} onClick={onApplyAndLaunch} className="rounded-lg border border-muted/30 px-4 py-2 text-sm transition-colors duration-150 hover:border-muted/60 disabled:opacity-40">
                      Apply &amp; relaunch
                    </button>
                  )
                ) : null}
                <button type="button" disabled={busy} onClick={onApply} className="rounded-lg px-3 py-2 text-sm text-primary transition-colors duration-150 hover:bg-primary/10 disabled:opacity-40">
                  Apply only
                </button>
                <span className="basis-full px-2 font-mono text-[11px] text-muted">{relaunch.ok ? `Relaunches on ${relaunch.label}` : relaunch.reason}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
