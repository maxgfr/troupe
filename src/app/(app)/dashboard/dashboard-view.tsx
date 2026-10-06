"use client";

import Link from "next/link";
import { useState } from "react";

import { ActorPortrait } from "~/app/_components/actor-portrait";
import { SELF_HOSTING_URL, useEdition } from "~/app/_components/edition";
import { PlayIcon } from "~/app/_components/icons";
import { EmptyState, ProviderWarning, Skeleton, statusChipBase } from "~/app/_components/ui";
import { VideoPoster } from "~/app/_components/video-poster";
import { STAGE_LABELS, type ProjectStage } from "~/modules/studio/stage";
import { platformName } from "~/modules/studio/platforms";

export interface DashboardProject {
  id: string;
  title: string;
  platform: string | null;
  format: string | null;
  status: string;
  createdAt?: string | Date;
  actorId?: string | null;
  // The newest saved video, played as the project's poster.
  latestVideoUrl?: string | null;
}

export interface DashboardActor {
  id: string;
  name: string;
  portraitUrl?: string | null;
}

// Whether any model can render, and if not, why (the browser edition's own
// model says why this browser cannot run it).
export type ModelReadiness = { ready: true } | { ready: false; reason?: string | null };

// A project's stage, on its poster: a dark glass chip whose dot carries the
// tone (cobalt while the studio works on it, green once a video is ready,
// quiet otherwise; never gold: a project card is not a decision).
const STAGE_DOTS: Record<ProjectStage, string> = {
  draft: "bg-white/60",
  scripting: "bg-white/60",
  generating: "bg-primary animate-pulse motion-reduce:animate-none",
  review: "bg-success",
  done: "bg-white",
};

export function StageChip({ status }: { status: string }) {
  const stage = (status in STAGE_LABELS ? status : "scripting") as ProjectStage;
  return (
    <span className={`${statusChipBase} bg-black/55 text-white backdrop-blur-md`}>
      <span aria-hidden className={`size-1.5 rounded-full ${STAGE_DOTS[stage]}`} />
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
          <a href={SELF_HOSTING_URL} target="_blank" rel="noreferrer" className="underline underline-offset-2">set up the self-hosted studio</a>.
        </>
      ) : (
        <>
          No video model can render yet. <Link href="/settings" className="underline underline-offset-2">Add an API key or a local model in Settings</Link> — projects and scripts work in the meantime.
        </>
      )}
    </ProviderWarning>
  );
}

// One project as a poster: its newest video (playing while hovered or
// focused), else its actor; the title, where it goes and its stage below.
// The grid's column width, for the pictures' sizes.
export const POSTER_SIZES = "(min-width: 1152px) 270px, (min-width: 1024px) 23vw, (min-width: 640px) 31vw, 47vw";

function ProjectCard({ project, actor, priority }: { project: DashboardProject; actor?: DashboardActor; priority: boolean }) {
  const [active, setActive] = useState(false);
  const meta = `${project.platform ? platformName(project.platform) : "platform —"} · ${project.format ?? "format —"}${project.createdAt ? ` · ${new Date(project.createdAt).toLocaleDateString()}` : ""}`;
  return (
    <li>
      <Link
        href={`/projects/${project.id}`}
        onPointerEnter={() => setActive(true)}
        onPointerLeave={() => setActive(false)}
        onFocus={() => setActive(true)}
        onBlur={() => setActive(false)}
        className="@container group relative block rounded-xl outline-offset-4"
      >
        <span className="relative block overflow-hidden rounded-xl bg-surface shadow-card">
          <VideoPoster
            src={project.latestVideoUrl}
            active={active}
            actor={actor}
            sizes={POSTER_SIZES}
            priority={priority}
            className="aspect-[3/4] w-full transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
          {/* The hairline that keeps a dark frame from melting into the stage. */}
          <span aria-hidden className="pointer-events-none absolute inset-0 rounded-xl shadow-[inset_0_0_0_1px_var(--picture-edge)]" />
          {project.latestVideoUrl ? (
            <span
              aria-hidden
              className="absolute right-3 bottom-3 flex size-11 translate-y-1 items-center justify-center rounded-full bg-primary text-on-primary opacity-0 shadow-overlay transition-[opacity,translate] duration-200 ease-out group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100"
            >
              <PlayIcon className="size-4 translate-x-px" />
            </span>
          ) : null}
        </span>
        <span className="mt-3 block min-w-0">
          <span className="block truncate font-medium">{project.title}</span>
          <span className="mt-0.5 block truncate font-mono text-xs tabular-nums text-muted">{meta}</span>
        </span>
        {/* Drawn on the poster's lower corner (its height is 4/3 of the
            card's width), read after the title. */}
        <span className="absolute top-[calc(133.333cqw-2.25rem)] left-2.5">
          <span className="sr-only">, </span>
          <StageChip status={project.status} />
        </span>
      </Link>
    </li>
  );
}

// The posters, while they load: one status for assistive technology around
// a list of poster shapes (a list cannot be the status itself).
export function PosterSkeletons() {
  return (
    <div role="status" aria-label="Loading">
      <ul aria-hidden className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-6">
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i} className="space-y-3">
            <Skeleton className="aspect-[3/4] w-full rounded-xl" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </li>
        ))}
      </ul>
    </div>
  );
}

// The path to a first video, with the cast that will play it.
function FirstProject({ actors, browser }: { actors: DashboardActor[]; browser: boolean }) {
  const cast = actors.filter((a) => a.portraitUrl).slice(0, 5);
  const steps = [
    "Pick a platform, a format and an actor",
    "Write three short lines",
    browser ? "Render it in this tab and download the MP4" : "Render it with your model and download the MP4",
  ];
  return (
    <EmptyState
      title="Create your first project"
      art={
        cast.length ? (
          <span className="flex -space-x-3">
            {cast.map((a) => (
              <ActorPortrait key={a.id} id={a.id} name={a.name} src={a.portraitUrl} label="" sizes="64px" priority className="size-14 rounded-full shadow-[0_0_0_3px_var(--troupe-color-surface)] sm:size-16" />
            ))}
          </span>
        ) : undefined
      }
      body={
        browser
          ? "Your first video takes about two minutes. Everything you make is saved in this browser."
          : "Your first video takes about two minutes, start to finish."
      }
      cta={{ label: "New project", href: "/projects/new" }}
    >
      <ol className="mx-auto mt-6 grid max-w-2xl gap-3 text-left text-sm sm:grid-cols-3">
        {steps.map((step, i) => (
          <li key={step} className="flex gap-3 rounded-xl bg-bg/60 px-4 py-3">
            <span className="font-mono text-xs leading-5 tabular-nums text-primary">{i + 1}</span>
            <span className="text-pretty">{step}</span>
          </li>
        ))}
      </ol>
    </EmptyState>
  );
}

// Pure view — testable without tRPC (screens.test.tsx).
export function DashboardView({
  projects,
  actors = [],
  readiness = { ready: true },
}: {
  projects: DashboardProject[];
  actors?: DashboardActor[];
  readiness?: ModelReadiness;
}) {
  const browser = useEdition().kind === "browser";
  const byId = new Map(actors.map((a) => [a.id, a]));
  return (
    <div className="space-y-6">
      <NoModelNotice readiness={readiness} />
      {projects.length === 0 ? (
        <FirstProject actors={actors} browser={browser} />
      ) : (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-6">
          {projects.map((p, i) => (
            <ProjectCard key={p.id} project={p} actor={p.actorId ? byId.get(p.actorId) : undefined} priority={i < 4} />
          ))}
        </ul>
      )}
    </div>
  );
}
