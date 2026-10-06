"use client";

import { isUuid } from "~/app/_components/errors";
import { NotFoundPage } from "~/app/_components/not-found-page";
import { useWorkspace } from "~/app/_components/workspace-context";
import { api } from "~/trpc/react";

// Every project tab (Video, Script, Export) in both editions: a project that
// does not exist, deleted or behind a mistyped link, is the not-found page
// with its way back. An id that is not a UUID cannot name a project, so it
// is never sent to the query (which would reject it as invalid input). Any other state is the tab's own to show.
export function ProjectGate({ projectId, children }: { projectId: string; children: React.ReactNode }) {
  const workspace = useWorkspace();
  const valid = isUuid(projectId);
  const project = api.studio.getProject.useQuery(
    { projectId },
    { enabled: valid && workspace.status === "ready", retry: false },
  );
  if (!valid || project.error?.data?.code === "NOT_FOUND") return <NotFoundPage />;
  return children;
}
