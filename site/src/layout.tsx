import { AppShell } from "~/app/_components/app-shell";
import { EditionProvider, type Edition } from "~/app/_components/edition";
import { EmptyState, PageHeader } from "~/app/_components/ui";
import { WorkspaceProvider } from "~/app/_components/workspace-context";
import { browserChat } from "./chat/ui";
import { browserRendering } from "./render/ui";
import { resetDemoData } from "./reset";
import { DemoTRPCProvider } from "./trpc";

// src/app/(app)/layout.tsx for the demo: the same shell around the same
// pages, with the router and database of this browser behind them.

const DEMO: Edition = { kind: "demo", resetData: resetDemoData, rendering: browserRendering, chat: browserChat };

export function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <DemoTRPCProvider>
      <EditionProvider value={DEMO}>
        <WorkspaceProvider>
          <AppShell>{children}</AppShell>
        </WorkspaceProvider>
      </EditionProvider>
    </DemoTRPCProvider>
  );
}

export function NotFound() {
  return (
    <>
      <PageHeader title="Page not found" />
      <EmptyState
        title="Nothing at this address"
        body="The link may be from an older version of the demo, or the project was deleted from this browser."
        cta={{ label: "Back to the dashboard", href: "/dashboard" }}
      />
    </>
  );
}
