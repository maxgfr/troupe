import { lazy, useMemo, type ComponentType } from "react";
import { createBrowserRouter, Navigate, Outlet, useParams } from "react-router";

// Each page loads with its first visit (the shell and the studio's data layer
// come first), as Next splits the self-hosted studio by route.
const ActorsPage = lazy(() => import("~/app/(app)/actors/page"));
const BenchmarkPage = lazy(() => import("~/app/(app)/benchmark/page"));
const DashboardPage = lazy(() => import("~/app/(app)/dashboard/page"));
const LibraryItemPage = lazy(() => import("~/app/(app)/library/[itemId]/page"));
const LibraryPage = lazy(() => import("~/app/(app)/library/page"));
const ProjectExportPage = lazy(() => import("~/app/(app)/projects/[projectId]/export/page"));
const ProjectMonitorPage = lazy(() => import("~/app/(app)/projects/[projectId]/page"));
const ProjectScriptPage = lazy(() => import("~/app/(app)/projects/[projectId]/script/page"));
const NewProjectPage = lazy(() => import("~/app/(app)/projects/new/page"));
const SettingsPage = lazy(() => import("~/app/(app)/settings/page"));
import { BrowserLayout, NotFound } from "./layout";

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

function LibraryItemRoute() {
  const itemId = useParams().itemId ?? "";
  const params = useMemo(() => settled({ itemId }), [itemId]);
  return <LibraryItemPage key={itemId} params={params} />;
}

export const router = createBrowserRouter(
  [
    {
      element: (
        <BrowserLayout>
          <Outlet />
        </BrowserLayout>
      ),
      children: [
        { index: true, element: <Navigate to="/dashboard" replace /> },
        { path: "dashboard", element: <DashboardPage /> },
        { path: "library", element: <LibraryPage /> },
        { path: "library/:itemId", element: <LibraryItemRoute /> },
        { path: "actors", element: <ActorsPage /> },
        { path: "benchmark", element: <BenchmarkPage /> },
        { path: "settings", element: <SettingsPage /> },
        { path: "projects/new", element: <NewProjectPage /> },
        { path: "projects/:projectId", element: <ProjectMonitor /> },
        { path: "projects/:projectId/script", element: <ProjectScript /> },
        { path: "projects/:projectId/export", element: <ProjectExport /> },
        // No access code in the browser edition: the studio is this browser's
        // alone.
        { path: "access", element: <Navigate to="/dashboard" replace /> },
        { path: "*", element: <NotFound /> },
      ],
    },
  ],
  { basename: `${import.meta.env.BASE_URL}app` },
);
