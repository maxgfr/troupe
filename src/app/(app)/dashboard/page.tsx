"use client";

import { DashboardView, type DashboardActor, type DashboardProject, type ModelReadiness } from "./dashboard-view";
import { api } from "~/trpc/react";
import { useEdition } from "~/app/_components/edition";
import { useWorkspace } from "~/app/_components/workspace-context";
import {
  EmptyState,
  ErrorNote,
  PageHeader,
  SignedOutNotice,
  Skeleton,
} from "~/app/_components/ui";

// The posters, while they load.
function PosterSkeletons() {
  return (
    <ul role="status" aria-label="Loading" className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-6">
      {Array.from({ length: 4 }, (_, i) => (
        <li key={i} className="space-y-3">
          <Skeleton className="aspect-[3/4] w-full rounded-xl" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </li>
      ))}
    </ul>
  );
}

export default function DashboardPage() {
  const workspace = useWorkspace();
  const projects = api.identity.projects.useQuery(
    { workspaceId: workspace.workspaceId ?? "" },
    { enabled: workspace.status === "ready", retry: false },
  );
  // The actors' faces: posters for projects without a video yet, and the
  // cast of the first project.
  const actors = api.actors.list.useQuery(undefined, { enabled: workspace.status === "ready", retry: false, staleTime: 5 * 60_000 });
  // Whether anything can render yet: the empty state and the list say so.
  const edition = useEdition();
  const models = api.studio.modelOptions.useQuery({}, { enabled: workspace.status === "ready", retry: false });
  const own = edition.kind === "browser" ? models.data?.models.find((m) => m.key === edition.rendering?.modelKey) : undefined;
  const readiness: ModelReadiness = !models.data || models.data.models.some((m) => m.available)
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
        <ErrorNote>Projects failed to load: {projects.error.message}</ErrorNote>
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
