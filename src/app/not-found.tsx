import { AppShell } from "~/app/_components/app-shell";
import { NotFoundPage } from "~/app/_components/not-found-page";
import { WorkspaceProvider } from "~/app/_components/workspace-context";

// Any address the studio has no page for, inside the studio's own shell like
// every other page (src/app/(app)/layout.tsx), instead of the framework's 404.
export default function NotFound() {
  return (
    <WorkspaceProvider>
      <AppShell>
        <NotFoundPage />
      </AppShell>
    </WorkspaceProvider>
  );
}
