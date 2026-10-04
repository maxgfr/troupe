import { useMemo, type ComponentType } from "react";
import { createBrowserRouter, Navigate, Outlet, useParams } from "react-router";

import ActorsPage from "~/app/(app)/actors/page";
import BenchmarkPage from "~/app/(app)/benchmark/page";
import DashboardPage from "~/app/(app)/dashboard/page";
import ProjectExportPage from "~/app/(app)/projects/[projectId]/export/page";
import ProjectMonitorPage from "~/app/(app)/projects/[projectId]/page";
import ProjectScriptPage from "~/app/(app)/projects/[projectId]/script/page";
import NewProjectPage from "~/app/(app)/projects/new/page";
import SettingsPage from "~/app/(app)/settings/page";
import { DemoLayout, NotFound } from "./layout";

// The same pages as src/app/(app), at the same paths, under /troupe/app.

type ProjectParams = { projectId: string };

// Next hands dynamic pages their params as a promise they `use()`. An
// already-settled one lets React read it without suspending.
function settled<T>(value: T): Promise<T> {
  return Object.assign(Promise.resolve(value), { status: "fulfilled", value });
}

function withProjectParams(Page: ComponentType<{ params: Promise<ProjectParams> }>) {
  return function ProjectRoute() {
    const projectId = useParams().projectId ?? "";
    const params = useMemo(() => settled({ projectId }), [projectId]);
    // A new project is a new page, as in Next: no state carries over.
    return <Page key={projectId} params={params} />;
  };
}

const ProjectMonitor = withProjectParams(ProjectMonitorPage);
const ProjectScript = withProjectParams(ProjectScriptPage);
const ProjectExport = withProjectParams(ProjectExportPage);

export const router = createBrowserRouter(
  [
    {
      element: (
        <DemoLayout>
          <Outlet />
        </DemoLayout>
      ),
      children: [
        { index: true, element: <Navigate to="/dashboard" replace /> },
        { path: "dashboard", element: <DashboardPage /> },
        { path: "actors", element: <ActorsPage /> },
        { path: "benchmark", element: <BenchmarkPage /> },
        { path: "settings", element: <SettingsPage /> },
        { path: "projects/new", element: <NewProjectPage /> },
        { path: "projects/:projectId", element: <ProjectMonitor /> },
        { path: "projects/:projectId/script", element: <ProjectScript /> },
        { path: "projects/:projectId/export", element: <ProjectExport /> },
        // No access code in the demo: the studio is this browser's alone.
        { path: "access", element: <Navigate to="/dashboard" replace /> },
        { path: "*", element: <NotFound /> },
      ],
    },
  ],
  { basename: `${import.meta.env.BASE_URL}app` },
);
