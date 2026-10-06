"use client";

import { BenchmarkCompare, type BenchmarkEntryView } from "./benchmark-compare";
import { OpenRunForm, RunListSection, type RunSummaryView } from "./benchmark-sections";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { api } from "~/trpc/react";
import { tallyWinner } from "~/modules/benchmark/winner";
import { BENCHMARK_LIST_LIMIT } from "~/modules/benchmark/list-limit";
import { dedupeRunsById } from "~/modules/benchmark/dedupe-runs";
import { launchSettings, type ModelOptionView } from "../projects/model-choice";
import { useWorkspace } from "~/app/_components/workspace-context";
import {
  EmptyState,
  ErrorNote,
  PageHeader,
  ProviderWarning,
  Section,
  SignedOutNotice,
  SkeletonRows,
} from "~/app/_components/ui";


// useSearchParams needs a Suspense boundary in the app router.
export default function BenchmarkPage() {
  return (
    <Suspense fallback={null}>
      <BenchmarkLab />
    </Suspense>
  );
}

function BenchmarkLab() {
  const router = useRouter();
  const workspace = useWorkspace();
  const utils = api.useUtils();
  const [runId, setRunId] = useState("");
  // ?run=<id> opens a comparison directly (the project page links here).
  const searchParams = useSearchParams();
  const [activeRunId, setActiveRunId] = useState<string | null>(searchParams.get("run"));
  // The first page is bounded server-side; older pages are
  // appended on demand through the createdAt cursor.
  const [olderRuns, setOlderRuns] = useState<RunSummaryView[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);

  // The workspace's runs, newest first — opening one is a click,
  // not a UUID hunt. The paste field stays for deep links from elsewhere.
  const runs = api.benchmark.list.useQuery(
    { workspaceId: workspace.workspaceId ?? "" },
    { enabled: workspace.status === "ready", retry: false },
  );
  // A refetched first page can re-surface a run already appended
  // in an older page — dedup by id so the list stays idempotent under refetch.
  const allRuns: RunSummaryView[] = dedupeRunsById([...(runs.data ?? []), ...olderRuns]);
  const hasOlder = !exhausted && (runs.data ?? []).length >= BENCHMARK_LIST_LIMIT;

  async function showOlder() {
    const last = allRuns[allRuns.length - 1];
    if (!last || !workspace.workspaceId || loadingOlder) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const page = await utils.benchmark.list.fetch({
        workspaceId: workspace.workspaceId,
        before: new Date(last.createdAt),
      });
      setOlderRuns((prev) => [...prev, ...page]);
      if (page.length < BENCHMARK_LIST_LIMIT) setExhausted(true);
    } catch (error) {
      setOlderError(error instanceof Error ? error.message : "Older comparisons could not load.");
    } finally {
      setLoadingOlder(false);
    }
  }

  const run = api.benchmark.get.useQuery(
    { workspaceId: workspace.workspaceId ?? "", runId: activeRunId ?? "" },
    { enabled: workspace.status === "ready" && Boolean(activeRunId), retry: false, refetchInterval: (q) => q.state.data?.entries.some((e) => e.status === "queued" || e.status === "in_progress") ? 4000 : false },
  );
  const vote = api.benchmark.vote.useMutation({ onSuccess: () => run.refetch() });

  const projectId = run.data?.projectId ?? null;
  const project = api.studio.getProject.useQuery(
    { projectId: projectId ?? "" },
    { enabled: Boolean(projectId), retry: false },
  );
  // The adopt decision checks the model against the project's REAL format and
  // the latest script's length, so the warning never lies about what
  // adopting will actually launch.
  const scripts = api.script.history.useQuery(
    { projectId: projectId ?? "" },
    { enabled: Boolean(projectId), retry: false },
  );
  const latestScript = scripts.data?.[scripts.data.length - 1];
  const projectOffers = api.studio.modelOptions.useQuery(
    { format: project.data?.format ?? "9:16", language: project.data?.language },
    { enabled: Boolean(project.data), retry: false },
  );
  const adopt = api.studio.updateChoices.useMutation({
    onSuccess: () => projectId && router.push(`/projects/${projectId}`),
  });

  const entries = (run.data?.entries ?? []) as unknown as BenchmarkEntryView[];
  // A shared top score is a TIE — nobody gets adopted until a
  // deciding vote lands; insertion order must never crown a winner.
  const { winnerId, tie } = tallyWinner(entries.filter((entry) => entry.status === "completed"));
  const winner = winnerId ? (entries.find((e) => e.id === winnerId) ?? null) : null;
  const winnerOption = winner ? ((projectOffers.data?.models ?? []) as ModelOptionView[]).find((o) => o.key === winner.modelKey) : undefined;
  const winnerName = winner?.label ?? winner?.modelKey;
  const adoptWarning = !winner || !project.data
    ? null
    : !winnerOption?.available
      ? `${winnerName} is no longer available. Check it in Settings.`
      : !winnerOption.compatible
        ? `${winnerName} does not render ${project.data.format} — choose another model or change the project format.`
        : latestScript && launchSettings(winnerOption, latestScript.estimatedDurationS).tooLong
          ? `${winnerName} cannot fit the current ${latestScript.estimatedDurationS}s script.`
          : null;

  return (
    <>
      <PageHeader
        title="Compare"
        lede="The same script on several models, side by side. Rate each render, then adopt the winner for the project."
      />

      {workspace.status === "unauthenticated" ? (
        <SignedOutNotice />
      ) : (
        <>
          <Section>
            <RunListSection
              pending={runs.isPending}
              errorMessage={runs.error?.message ?? null}
              runs={allRuns}
              activeRunId={activeRunId}
              onOpen={setActiveRunId}
              hasOlder={hasOlder}
              loadingOlder={loadingOlder}
              onShowOlder={() => void showOlder()}
            />
            {olderError ? <ErrorNote>{olderError}</ErrorNote> : null}
            {allRuns.length ? (
              <OpenRunForm
                runId={runId}
                onChange={setRunId}
                onOpen={() => runId.trim() && setActiveRunId(runId.trim())}
              />
            ) : null}
          </Section>

          <Section>
            {activeRunId === null ? (
              <EmptyState
                title={allRuns.length ? "Open a comparison" : "No comparison yet"}
                body={
                  allRuns.length
                    ? "Pick one above to watch its renders side by side and rate them."
                    : "Compare models, on a project's Video tab, renders its script on each model that can and lines the renders up here. It needs at least two available models."
                }
                cta={allRuns.length ? undefined : { label: "Go to your projects", href: "/dashboard" }}
              />
            ) : run.isPending ? (
              <SkeletonRows rows={3} />
            ) : run.error ? (
              <ErrorNote>The run failed to load: {run.error.message}</ErrorNote>
            ) : (
              <>
                {tie ? (
                  <ProviderWarning>
                    Tie — add a deciding vote before adopting: two renders share the top score,
                    and insertion order must not pick your model.
                  </ProviderWarning>
                ) : null}
                {vote.error || adopt.error || project.error || scripts.error || projectOffers.error ? <ErrorNote>{(vote.error ?? adopt.error ?? project.error ?? scripts.error ?? projectOffers.error)!.message}</ErrorNote> : null}
                <BenchmarkCompare
                  entries={entries}
                  onVote={vote.isPending ? undefined : (entryId, score) =>
                    workspace.workspaceId &&
                    activeRunId &&
                    vote.mutate({
                      workspaceId: workspace.workspaceId,
                      runId: activeRunId,
                      entryId,
                      score,
                    })
                  }
                  winnerEntryId={winner?.id ?? null}
                  brief={run.data?.brief ?? null}
                  briefLines={run.data?.briefLines ?? null}
                  onAdopt={
                    // The adopt decision waits for the capability data: offering
                    // it while modelOptions (or the script duration it checks
                    // with) loads would skip the warning.
                    projectId && project.data && !projectOffers.isPending && !scripts.isPending && !projectOffers.error && !scripts.error && !adopt.isPending
                      ? (modelKey) =>
                          adopt.mutate({ projectId, modelKey })
                      : undefined
                  }
                  adoptWarning={adoptWarning}
                />
              </>
            )}
          </Section>
        </>
      )}
    </>
  );
}
