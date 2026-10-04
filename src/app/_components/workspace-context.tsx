"use client";

import { createContext, useContext } from "react";

import { api } from "~/trpc/react";

export type WorkspaceState =
  | { status: "loading"; workspaceId: null; workspaceName: null }
  | { status: "unauthenticated"; workspaceId: null; workspaceName: null }
  | { status: "empty"; workspaceId: null; workspaceName: null }
  | { status: "error"; workspaceId: null; workspaceName: null; message: string }
  | { status: "ready"; workspaceId: string; workspaceName: string };

const WorkspaceContext = createContext<WorkspaceState>({
  status: "loading",
  workspaceId: null,
  workspaceName: null,
});

// The server initializes one personal studio before answering this query.
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const query = api.identity.myWorkspaces.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  let state: WorkspaceState;
  if (query.isPending) {
    state = { status: "loading", workspaceId: null, workspaceName: null };
  } else if (query.error) {
    state =
      query.error.data?.code === "UNAUTHORIZED"
        ? { status: "unauthenticated", workspaceId: null, workspaceName: null }
        : { status: "error", workspaceId: null, workspaceName: null, message: query.error.message };
  } else if (query.data.length === 0) {
    state = { status: "empty", workspaceId: null, workspaceName: null };
  } else {
    const first = query.data[0]!;
    state = { status: "ready", workspaceId: first.id, workspaceName: first.name };
  }

  return <WorkspaceContext.Provider value={state}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
