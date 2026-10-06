"use client";

import Link from "next/link";

import { ActorPortrait } from "~/app/_components/actor-portrait";
import { usePageTitle } from "~/app/_components/page-title";
import { useStageHue } from "~/app/_components/stage";
import { PageHeader } from "~/app/_components/ui";
import { useWorkspace } from "~/app/_components/workspace-context";
import { actorHue } from "~/modules/scene";
import { platformName } from "~/modules/studio/platforms";
import { api } from "~/trpc/react";

export type ProjectTab = "video" | "script" | "export";

const TABS: { id: ProjectTab; label: string; path: string }[] = [
  { id: "video", label: "Video", path: "" },
  { id: "script", label: "Script", path: "/script" },
  { id: "export", label: "Export", path: "/export" },
];

// Every project page opens the same way (docs/PRODUCT-MAP.md): the actor's
// portrait, the title, where the video goes, then the tabs Video · Script ·
// Export. The page lights the stage in the actor's hue.
export function ProjectHeader({
  projectId,
  tab,
  actions,
  aside,
}: {
  projectId: string;
  tab: ProjectTab;
  // Beside the title: rename, delete.
  actions?: React.ReactNode;
  // At the end of the tab row: the chat on phones.
  aside?: React.ReactNode;
}) {
  const workspace = useWorkspace();
  const project = api.studio.getProject.useQuery(
    { projectId },
    { enabled: workspace.status === "ready", retry: false },
  );
  const actors = api.actors.list.useQuery(undefined, {
    enabled: Boolean(project.data?.actorId),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const actor = actors.data?.find((a) => a.id === project.data?.actorId);
  useStageHue(actor ? actorHue(actor.id) : null);
  usePageTitle(TABS.find((t) => t.id === tab)?.label, project.data?.title);

  return (
    <>
      <PageHeader
        title={
          project.data?.title ??
          (project.isPending ? (
            <>
              <span className="sr-only">Project</span>
              <span
                aria-hidden
                className="inline-block h-8 w-64 max-w-full animate-pulse rounded-lg bg-fg/[0.06] align-middle motion-reduce:animate-none"
              />
            </>
          ) : (
            "Project"
          ))
        }
        media={
          actor ? (
            <ActorPortrait
              id={actor.id}
              name={actor.name}
              src={actor.portraitUrl}
              label=""
              sizes="80px"
              priority
              className="size-16 shrink-0 rounded-2xl shadow-card outline-1 -outline-offset-1 outline-(--picture-edge) sm:size-20"
            />
          ) : undefined
        }
        lede={
          project.data ? (
            <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
              {`${platformName(project.data.platform)} · ${project.data.format} · ${project.data.language.toUpperCase()}`}
              {actor ? (
                <span data-testid="project-actor" className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true">·</span>
                  {actor.name}
                </span>
              ) : null}
            </span>
          ) : undefined
        }
        actions={actions}
      />
      <div className="-mt-2 mb-8 flex items-center justify-between gap-3 shadow-[inset_0_-1px_0_var(--troupe-color-line)]">
        <nav aria-label="Project" className="-mb-px flex items-center gap-1">
          {TABS.map((t) => {
            const current = t.id === tab;
            return (
              <Link
                key={t.id}
                href={`/projects/${projectId}${t.path}`}
                aria-current={current ? "page" : undefined}
                className={`relative flex min-h-11 items-center px-3 text-sm font-medium transition-colors duration-150 first:pl-0 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors after:duration-150 first:after:left-0 ${
                  current ? "text-fg after:bg-primary" : "text-muted after:bg-transparent hover:text-fg"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
        {aside}
      </div>
    </>
  );
}
