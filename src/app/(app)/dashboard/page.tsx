"use client";

import Link from "next/link";

import { DashboardView, type DashboardProject } from "./dashboard-view";
import { api } from "~/trpc/react";
import { useWorkspace } from "~/app/_components/workspace-context";
import {
  EmptyState,
  ErrorNote,
  PageHeader,
  Section,
  SignedOutNotice,
  SkeletonRows,
} from "~/app/_components/ui";

export default function DashboardPage() {
  const workspace = useWorkspace();
  const projects = api.identity.projects.useQuery(
    { workspaceId: workspace.workspaceId ?? "" },
    { enabled: workspace.status === "ready", retry: false },
  );

  return (
    <>
      <PageHeader
        title="Dashboard"
        lede="Your scripts, video experiments and completed renders."
        actions={
          <Link
            href="/projects/new"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-opacity duration-150 hover:opacity-90"
          >
            New project
          </Link>
        }
      />
      <Section>
        {workspace.status === "loading" || (workspace.status === "ready" && projects.isPending) ? (
          <SkeletonRows rows={4} />
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
          <DashboardView projects={(projects.data ?? []) as DashboardProject[]} />
        )}
      </Section>
    </>
  );
}
