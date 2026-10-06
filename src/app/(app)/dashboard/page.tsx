"use client";

import { errorText } from "~/app/_components/errors";
import {
  DashboardView,
  PosterSkeletons,
  type DashboardActor,
  type DashboardProject,
  type ModelReadiness,
} from "./dashboard-view";
import { api } from "~/trpc/react";
import { useEdition } from "~/app/_components/edition";
import { usePageTitle } from "~/app/_components/page-title";
import { useWorkspace } from "~/app/_components/workspace-context";
import { EmptyState, ErrorNote, PageHeader, SignedOutNotice } from "~/app/_components/ui";

export default function DashboardPage() {
  usePageTitle("Projects");
  const workspace = useWorkspace();
  const projects = api.identity.projects.useQuery(
    { workspaceId: workspace.workspaceId ?? "" },
    { enabled: workspace.status === "ready", retry: false },
  );
  // The actors' faces: posters for projects without a video yet, and the
  // cast of the first project.
  const actors = api.actors.list.useQuery(undefined, {
    enabled: workspace.status === "ready",
    retry: false,
    staleTime: 5 * 60_000,
  });
  // Whether anything can render yet: the empty state and the list say so.
  const edition = useEdition();
  const models = api.studio.modelOptions.useQuery({}, { enabled: workspace.status === "ready", retry: false });
  const own =
    edition.kind === "browser" ? models.data?.models.find((m) => m.key === edition.rendering?.modelKey) : undefined;
  const readiness: ModelReadiness =
    !models.data || models.data.models.some((m) => m.available)
      ? { ready: true }
      : { ready: false, reason: own?.unavailableReason ?? null };

  return (
    <>
      <PageHeader
        title="Projects"
        lede="Every video you are making, newest first, with its latest render as the poster."
      />
      {workspace.status === "loading" || (workspace.status === "ready" && projects.isPending) ? (
        <PosterSkeletons />
      ) : workspace.status === "unauthenticated" ? (
        <SignedOutNotice />
      ) : workspace.status === "empty" ? (
        <EmptyState
          title="Setting up your studio"
          body="Your studio is still being set up. Reload in a moment; if this stays, check that the database is running."
          cta={{ label: "Reload", href: "/dashboard" }}
        />
      ) : workspace.status === "error" ? (
        <ErrorNote>The workspace list failed to load: {workspace.message}</ErrorNote>
      ) : projects.error ? (
        <ErrorNote>Projects failed to load: {errorText(projects.error)}</ErrorNote>
      ) : (
        <DashboardView
          projects={(projects.data ?? []) as DashboardProject[]}
          actors={(actors.data ?? []) as DashboardActor[]}
          readiness={readiness}
        />
      )}
    </>
  );
}
