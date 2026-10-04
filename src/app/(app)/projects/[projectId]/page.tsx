"use client";

import { GenerationTimeline, type GenerationRow } from "./generation-timeline";
import { LaunchPanel } from "./launch-panel";
import { ChatPanel } from "./chat-panel";
import { chatLaunchBase } from "./chat-launch";
import { ProjectActions } from "./project-actions";
import { use, useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";
import { useWorkspace } from "~/app/_components/workspace-context";
import {
  ErrorNote,
  PageHeader,
  ProviderWarning,
  SignedOutNotice,
  SkeletonRows,
} from "~/app/_components/ui";
import { pickModel, type ModelOptionView } from "../model-choice";

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
  const [chatOpen, setChatOpen] = useState(false);
  const closeChat = useCallback(() => setChatOpen(false), []);

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
  const busy = updateModel.isPending || launch.isPending || compare.isPending;
  const loadError = project.error ?? generations.error ?? history.error ?? models.error;

  return (
    <>
      <PageHeader
        title={project.data?.title ?? "Project"}
        lede={
          project.data
            ? `${project.data.platform} · ${project.data.format} · ${project.data.language}`
            : undefined
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
            <button type="button" onClick={() => setChatOpen(true)} className="rounded-lg border border-muted/30 px-3 py-1 text-sm transition-colors duration-150 hover:border-muted/60 lg:hidden">
              Chat
            </button>
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
            onRelaunch={busy || relaunch.isPending ? undefined : (generationId) => { setLaunchError(null); relaunch.mutate({ projectId, generationId }); }}
          />

          <div className="rounded-xl border border-muted/20 px-5 py-4">
            <h2 className="text-base font-semibold">Launch</h2>
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
                    launch.mutate({ projectId, scriptId: latestScript.id, tier: "draft", ...request });
                  }}
                  onCompare={(plan) => {
                    setLaunchError(null);
                    compare.mutate({ projectId, scriptId: latestScript.id, ...plan });
                  }}
                />
              </>
            )}
            {launchError ? <div className="mt-3"><ErrorNote>{launchError}</ErrorNote></div> : null}
          </div>
        </div>
        <ChatPanel
          projectId={projectId}
          versions={history.data ?? []}
          base={chatBase}
          currentActorId={project.data?.actorId ?? null}
          open={chatOpen}
          onClose={closeChat}
        />
        </div>
      )}
    </>
  );
}
