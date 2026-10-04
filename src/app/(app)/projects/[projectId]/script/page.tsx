"use client";

import { ScriptLines, type ScriptLineView } from "./script-lines";
import { ScriptComposer } from "./script-composer";
import { ScriptVersions, type ScriptVersionView } from "./script-versions";
import { use } from "react";
import Link from "next/link";

import { api } from "~/trpc/react";
import { useWorkspace } from "~/app/_components/workspace-context";
import {
  EmptyState,
  ErrorNote,
  PageHeader,
  SignedOutNotice,
  SkeletonRows,
} from "~/app/_components/ui";


export default function ScriptPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const workspace = useWorkspace();
  const enabled = workspace.status === "ready";
  const utils = api.useUtils();

  const history = api.script.history.useQuery(
    { projectId },
    { enabled, retry: false },
  );
  const paste = api.script.paste.useMutation({
    onSuccess: () => utils.script.history.invalidate(),
  });
  const restore = api.script.restore.useMutation({
    onSuccess: () => utils.script.history.invalidate(),
  });
  const setEmotion = api.script.setLineEmotion.useMutation({
    onSuccess: () => utils.script.history.invalidate(),
  });

  const latest = history.data?.[history.data.length - 1];
  return (
    <>
      <PageHeader
        title="Script"
        lede="Write or paste your dialogue and choose each line's emotion. Every save keeps a new version."
        actions={
          <Link href={`/projects/${projectId}`} className="text-sm text-primary hover:underline">
            ← Back to the project
          </Link>
        }
      />

      {workspace.status === "unauthenticated" ? (
        <SignedOutNotice />
      ) : workspace.status === "loading" || (enabled && history.isPending) ? (
        <SkeletonRows rows={4} />
      ) : history.error ? (
        <ErrorNote>The script history failed to load: {history.error.message}</ErrorNote>
      ) : (
        <div className="max-w-2xl space-y-8">
          {latest ? (
            <>
              <p className="font-mono text-xs text-muted">
                version {latest.version} · origin {latest.origin} · ≈{latest.estimatedDurationS}s
              </p>
              <ScriptLines
                lines={latest.lines as ScriptLineView[]}
                onEmotion={paste.isPending || setEmotion.isPending ? undefined : (lineIndex, emotion) =>
                  workspace.workspaceId &&
                  setEmotion.mutate({
                    projectId,
                    scriptId: latest.id,
                    lineIndex,
                    emotion,
                  })
                }
              />
            </>
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
