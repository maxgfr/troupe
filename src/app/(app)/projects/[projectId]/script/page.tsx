"use client";

import { ScriptLines, type ScriptLineView } from "./script-lines";
import { ScriptComposer } from "./script-composer";
import { ScriptVersions, type ScriptVersionView } from "./script-versions";
import { use } from "react";

import { api } from "~/trpc/react";
import { useWorkspace } from "~/app/_components/workspace-context";
import { ArrowRightIcon } from "~/app/_components/icons";
import {
  ButtonLink,
  EmptyState,
  ErrorNote,
  ProviderWarning,
  SignedOutNotice,
  SkeletonRows,
} from "~/app/_components/ui";
import { pickModel, type ModelOptionView } from "../../model-choice";
import { ProjectHeader } from "../project-header";
import { useLineEmotion } from "./line-emotion";

export default function ScriptPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const workspace = useWorkspace();
  const enabled = workspace.status === "ready";
  const utils = api.useUtils();

  const history = api.script.history.useQuery(
    { projectId },
    { enabled, retry: false },
  );
  // The model the project launches on, for its longest clip.
  const project = api.studio.getProject.useQuery({ projectId }, { enabled, retry: false });
  const models = api.studio.modelOptions.useQuery(
    { format: project.data?.format ?? "9:16", language: project.data?.language },
    { enabled: Boolean(project.data), retry: false },
  );
  const model = pickModel((models.data?.models ?? []) as ModelOptionView[], project.data?.modelKey, models.data?.defaultModelKey);
  const longestS = model ? Math.max(0, ...model.capabilities.durationsS) : 0;
  const limit = model && longestS > 0 ? { seconds: longestS, modelLabel: model.label } : null;

  const paste = api.script.paste.useMutation({
    onSuccess: () => utils.script.history.invalidate(),
  });
  const restore = api.script.restore.useMutation({
    onSuccess: () => utils.script.history.invalidate(),
  });
  const setEmotion = useLineEmotion(projectId);

  const latest = history.data?.[history.data.length - 1];
  const latestTooLong = Boolean(latest && limit && latest.estimatedDurationS > limit.seconds);
  return (
    <>
      <ProjectHeader projectId={projectId} tab="script" />

      {workspace.status === "unauthenticated" ? (
        <SignedOutNotice />
      ) : workspace.status === "loading" || (enabled && history.isPending) ? (
        <SkeletonRows rows={4} />
      ) : history.error ? (
        <ErrorNote>The script history failed to load: {history.error.message}</ErrorNote>
      ) : (
        <div className="max-w-2xl space-y-10">
          <p className="-mt-2 max-w-[65ch] text-pretty text-sm text-muted">
            One line per sentence: the first is the hook, the last the call to action. Each line&apos;s emotion directs the voice; saving new text keeps a new version.
          </p>
          {latest ? (
            <div className="space-y-4">
              <ScriptLines
                lines={latest.lines as ScriptLineView[]}
                onEmotion={paste.isPending ? undefined : (lineIndex, emotion) =>
                  workspace.workspaceId &&
                  setEmotion.mutate({
                    projectId,
                    scriptId: latest.id,
                    lineIndex,
                    emotion,
                  })
                }
              />
              {/* The next step: render this version. */}
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 pt-2">
                <p className="font-mono text-xs tabular-nums text-muted">
                  version {latest.version} · {latest.origin === "chat" ? "from the chat" : "written here"} ·{" "}
                  <span className={latestTooLong ? "text-warning" : undefined}>≈{latest.estimatedDurationS} s to say</span>
                </p>
                <ButtonLink href={`/projects/${projectId}#launch`} variant="outline">
                  Launch a render
                  <ArrowRightIcon className="size-4" />
                </ButtonLink>
              </div>
              {latestTooLong && limit ? (
                <ProviderWarning>
                  Version {latest.version} takes about {latest.estimatedDurationS} s to say, but {limit.modelLabel} renders at most {limit.seconds} s. Shorten it below, or pick another model on the Video tab.
                </ProviderWarning>
              ) : null}
            </div>
          ) : (
            <EmptyState
              title="No script yet — paste one to begin"
              body="Write your script, then choose an emotion for each line to guide the performance."
            />
          )}

          <ScriptComposer
            key={latest?.id ?? "empty"}
            pending={paste.isPending}
            enabled={enabled && !setEmotion.isPending && !restore.isPending}
            initialText={latest ? latest.lines.map((l) => l.text).join("\n") : ""}
            errorMessage={paste.error?.message ?? null}
            limit={limit}
            onSave={(text) => workspace.workspaceId && paste.mutate({ projectId, text })}
          />
          <ScriptVersions
            versions={(history.data ?? []) as ScriptVersionView[]}
            currentId={latest?.id ?? null}
            busy={restore.isPending || paste.isPending}
            onRestore={(scriptId) => restore.mutate({ projectId, scriptId })}
          />
          {setEmotion.error ?? restore.error ? <ErrorNote>{(setEmotion.error ?? restore.error)!.message}</ErrorNote> : null}
        </div>
      )}
    </>
  );
}
