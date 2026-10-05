import Link from "next/link";

import { SELF_HOSTING_URL, useEdition } from "~/app/_components/edition";
import { EmptyState, ProviderWarning } from "~/app/_components/ui";
import { STAGE_LABELS, type ProjectStage } from "~/modules/studio/stage";
import { platformName } from "~/modules/studio/platforms";

export interface DashboardProject {
  id: string;
  title: string;
  platform: string | null;
  format: string | null;
  status: string;
  createdAt?: string | Date;
}

// Whether any model can render, and if not, why (the browser edition's own
// model says why this browser cannot run it).
export type ModelReadiness = { ready: true } | { ready: false; reason?: string | null };

// Cobalt while the studio works on it, green once a video is ready, quiet
// otherwise; never gold (a dashboard row is not a decision).
const STAGE_TONES: Record<ProjectStage, string> = {
  draft: "bg-surface text-muted",
  scripting: "bg-surface text-muted",
  generating: "bg-primary/15 text-primary",
  review: "bg-success/15 text-success",
  done: "bg-surface text-fg",
};

export function StageChip({ status }: { status: string }) {
  const stage = (status in STAGE_LABELS ? status : "scripting") as ProjectStage;
  return (
    <span className={`inline-block shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${STAGE_TONES[stage]}`}>
      {STAGE_LABELS[stage]}
    </span>
  );
}

// Said once, above the projects: nothing will render until a model is ready.
function NoModelNotice({ readiness }: { readiness: ModelReadiness }) {
  const browser = useEdition().kind === "browser";
  if (readiness.ready) return null;
  return (
    <ProviderWarning>
      {browser ? (
        <>
          {readiness.reason ?? "This browser cannot render videos."} You can still write projects and scripts here; to render them on your machine,{" "}
          <a href={SELF_HOSTING_URL} target="_blank" rel="noreferrer" className="underline underline-offset-2">set up the self-hosted studio ↗</a>.
        </>
      ) : (
        <>
          No video model can render yet. <Link href="/settings" className="underline underline-offset-2">Add an API key or a local model in Settings</Link> — projects and scripts work in the meantime.
        </>
      )}
    </ProviderWarning>
  );
}

// Pure view — testable without tRPC (screens.test.tsx).
export function DashboardView({ projects, readiness = { ready: true } }: { projects: DashboardProject[]; readiness?: ModelReadiness }) {
  const browser = useEdition().kind === "browser";
  if (projects.length === 0) {
    return (
      <div className="space-y-4">
        <NoModelNotice readiness={readiness} />
        <EmptyState
          title="Create your first project"
          body={
            browser
              ? "Pick a platform, format, language and actor, write a short script, then render it right here. Everything you make is saved in this browser."
              : "Pick a platform, format, language and actor, then write a short script and render it with your model."
          }
          cta={{ label: "New project", href: "/projects/new" }}
        />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <NoModelNotice readiness={readiness} />
      <ul className="divide-y divide-muted/15 rounded-xl border border-muted/20">
        {projects.map((p) => (
          <li key={p.id}>
            <Link
              href={`/projects/${p.id}`}
              className="flex items-center justify-between gap-4 px-4 py-3 transition-colors duration-150 hover:bg-surface"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{p.title}</p>
                <p className="mt-0.5 font-mono text-xs tabular-nums text-muted">
                  {p.platform ? platformName(p.platform) : "platform —"} · {p.format ?? "format —"}{p.createdAt ? ` · ${new Date(p.createdAt).toLocaleDateString()}` : ""}
                </p>
              </div>
              <StageChip status={p.status} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
