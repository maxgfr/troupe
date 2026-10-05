"use client";

import { GenerationTimeline, type GenerationRow } from "./generation-timeline";
import { LaunchPanel } from "./launch-panel";
import { ChatPanel } from "./chat-panel";
import { ChatDrawer } from "./chat-drawer";
import { chatLaunchBase } from "./chat-launch";
import { ProjectActions } from "./project-actions";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";
import { ActorPortrait } from "~/app/_components/actor-portrait";
import { useWorkspace } from "~/app/_components/workspace-context";
import {
  ErrorNote,
  PageHeader,
  ProviderWarning,
  SignedOutNotice,
  SkeletonRows,
} from "~/app/_components/ui";
import { pickModel, type ModelOptionView } from "../model-choice";
import { useMediaQuery } from "~/app/_components/use-media-query";
import { platformName } from "~/modules/studio/platforms";

export default function ProjectMonitorPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const router = useRouter();
  const workspace = useWorkspace();
  const enabled = workspace.status === "ready";
  const utils = api.useUtils();
  const [launchError, setLaunchError] = useState<string | null>(null);
  // The chat sits beside the timeline from the large breakpoint (64rem) up,
  // and opens in a drawer below it.
  const wide = useMediaQuery("(min-width: 64rem)");

  const project = api.studio.getProject.useQuery(
    { projectId },
    { enabled, retry: false },
  );
  const generations = api.generation.forProject.useQuery(
    { projectId },
    {
      enabled,
      retry: false,
      refetchInterval: (q) =>
        q.state.data?.some((g) => g.status === "queued" || g.status === "in_progress")
          ? 4000
          : false,
    },
  );
  const history = api.script.history.useQuery(
    { projectId },
    { enabled, retry: false },
  );
  const latestScript = history.data?.[history.data.length - 1];
  // The project's actor, pictured in the header.
  const actors = api.actors.list.useQuery(undefined, { enabled: Boolean(project.data?.actorId), retry: false, staleTime: 5 * 60_000 });
  const actor = actors.data?.find((a) => a.id === project.data?.actorId);

  const models = api.studio.modelOptions.useQuery(
    { format: project.data?.format ?? "9:16", language: project.data?.language },
    { enabled: Boolean(project.data), retry: false },
  );
  const options = (models.data?.models ?? []) as ModelOptionView[];
  // The project's own choice, else the studio default.
  const model = pickModel(options, project.data?.modelKey, models.data?.defaultModelKey);
  const pinned = project.data?.modelKey ? options.find((o) => o.key === project.data?.modelKey) : undefined;
  const pinnedUnusable = Boolean(project.data?.modelKey) && model?.key !== project.data?.modelKey;

  const updateModel = api.studio.updateChoices.useMutation({
    onSuccess: () => utils.studio.getProject.invalidate({ projectId }),
    onError: (error) => setLaunchError(error.message),
  });
  const launch = api.generation.launchText.useMutation({
    onSuccess: () => utils.generation.forProject.invalidate(),
    onError: (e) => setLaunchError(e.message),
  });
  const relaunch = api.generation.relaunch.useMutation({
    onSuccess: () => utils.generation.forProject.invalidate(),
    onError: (e) => setLaunchError(e.message),
  });
  const compare = api.benchmark.start.useMutation({
    // Open the comparison that was just started.
    onSuccess: (run) => router.push(`/benchmark?run=${run.id}`),
    onError: (e) => setLaunchError(e.message),
  });
  const rename = api.studio.updateChoices.useMutation({
    onSuccess: () => utils.studio.getProject.invalidate({ projectId }),
    onError: (error) => setLaunchError(error.message),
  });
  const remove = api.studio.deleteProject.useMutation({
    onSuccess: async () => {
      await utils.identity.projects.invalidate();
      router.push("/dashboard");
    },
    onError: (error) => setLaunchError(error.message),
  });
  // The chat writes for, and relaunches with, the newest render's settings.
  const newest = generations.data?.[0];
  const chatBase = chatLaunchBase(options, model, newest ? { modelKey: newest.modelKey, durationS: newest.durationS, resolution: newest.resolution } : null);
  const chatProps = { projectId, versions: history.data ?? [], base: chatBase, currentActorId: project.data?.actorId ?? null };
  const busy = updateModel.isPending || launch.isPending || compare.isPending;
  // The script page's "Launch a render" lands on #launch, which only exists
  // once the page has loaded.
  const launchReady = Boolean(latestScript) && !models.isPending;
  useEffect(() => {
    if (launchReady && window.location.hash === "#launch") document.getElementById("launch")?.scrollIntoView({ block: "start" });
  }, [launchReady]);
  const loadError = project.error ?? generations.error ?? history.error ?? models.error;

  return (
    <>
      <PageHeader
        title={project.data?.title ?? "Project"}
        lede={
          project.data ? (
            <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
              {`${platformName(project.data.platform)} · ${project.data.format} · ${project.data.language.toUpperCase()}`}
              {actor ? (
                <span data-testid="project-actor" className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true">·</span>
                  <ActorPortrait
                    id={actor.id}
                    name={actor.name}
                    src={actor.portraitUrl}
                    label=""
                    className="size-5 shrink-0 rounded-full outline-1 -outline-offset-1 outline-(--picture-edge)"
                  />
                  {actor.name}
                </span>
              ) : null}
            </span>
          ) : undefined
        }
        actions={
          <nav className="flex flex-wrap items-center gap-3 text-sm">
            {/* A model chosen for this project (in the wizard or adopted from
                a comparison) stays visible. */}
            {pinned ? (
              <span
                data-testid="project-model"
                className="rounded-md bg-spot/20 px-2 py-0.5 font-mono text-xs text-fg"
              >
                {pinned.label} · chosen
              </span>
            ) : null}
            {wide ? null : <ChatDrawer {...chatProps} />}
            <Link href={`/projects/${projectId}/script`} className="text-primary hover:underline">
              Script
            </Link>
            <Link href={`/projects/${projectId}/export`} className="text-primary hover:underline">
              Export
            </Link>
            {project.data ? (
              <ProjectActions
                title={project.data.title}
                renderCount={(generations.data ?? []).filter((g) => g.outputAssetId).length}
                busy={rename.isPending || remove.isPending}
                onRename={(title) => rename.mutate({ projectId, title })}
                onDelete={() => remove.mutate({ projectId })}
              />
            ) : null}
          </nav>
        }
      />

      {workspace.status === "unauthenticated" ? (
        <SignedOutNotice />
      ) : workspace.status === "loading" || (enabled && generations.isPending) ? (
        <SkeletonRows rows={4} />
      ) : loadError ? (
        <ErrorNote>The project failed to load: {loadError.message}</ErrorNote>
      ) : (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)] lg:items-start lg:gap-8">
        <div className="min-w-0 space-y-8">
          <GenerationTimeline
            generations={(generations.data ?? []) as GenerationRow[]}
            projectId={projectId}
            projectTitle={project.data?.title}
            onRelaunch={busy || relaunch.isPending ? undefined : (generationId) => { setLaunchError(null); relaunch.mutate({ projectId, generationId }); }}
          />

          <section id="launch" aria-labelledby="launch-title" className="scroll-mt-24 rounded-xl border border-muted/20 px-5 py-4">
            <h2 id="launch-title" className="text-base font-semibold">Launch</h2>
            {history.isPending || models.isPending ? <SkeletonRows rows={2} /> : !latestScript ? (
              <p className="mt-2 text-sm text-muted">
                A script comes first —{" "}
                <Link href={`/projects/${projectId}/script`} className="text-primary hover:underline">
                  write it here
                </Link>
                .
              </p>
            ) : (
              <>
                {pinnedUnusable ? (
                  <ProviderWarning>
                    The model chosen for this project is unavailable{pinned?.unavailableReason ? `: ${pinned.unavailableReason}` : ""}. Pick another one below.
                  </ProviderWarning>
                ) : null}
                <LaunchPanel
                  options={options}
                  model={model}
                  estimatedS={latestScript.estimatedDurationS}
                  busy={busy}
                  onModel={(modelKey) => {
                    setLaunchError(null);
                    updateModel.mutate({ projectId, modelKey });
                  }}
                  onLaunch={(request) => {
                    setLaunchError(null);
                    launch.mutate({ projectId, scriptId: latestScript.id, ...request });
                  }}
                  onCompare={(plan) => {
                    setLaunchError(null);
                    compare.mutate({ projectId, scriptId: latestScript.id, ...plan });
                  }}
                />
              </>
            )}
            {launchError ? <div className="mt-3"><ErrorNote>{launchError}</ErrorNote></div> : null}
          </section>
        </div>
        {wide ? (
          <aside aria-label="Script chat" className="sticky top-24 h-[calc(100dvh-15rem)] min-h-[28rem] border-l border-muted/20 pl-6">
            <ChatPanel {...chatProps} />
          </aside>
        ) : null}
        </div>
      )}
    </>
  );
}
