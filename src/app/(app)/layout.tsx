import { AppShell } from "~/app/_components/app-shell";
import { WorkspaceProvider } from "~/app/_components/workspace-context";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <AppShell>{children}</AppShell>
    </WorkspaceProvider>
  );
}
