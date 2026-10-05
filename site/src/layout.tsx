import { AppShell } from "~/app/_components/app-shell";
import { EditionProvider, type Edition } from "~/app/_components/edition";
import { EmptyState, PageHeader } from "~/app/_components/ui";
import { WorkspaceProvider } from "~/app/_components/workspace-context";
import { browserChat } from "./chat/ui";
import { localData } from "./data/local-data";
import { browserRendering } from "./render/ui";
import { BrowserTRPCProvider } from "./trpc";

// src/app/(app)/layout.tsx for the browser edition: the same shell around the
// same pages, with the router and database of this browser behind them.

const BROWSER_EDITION: Edition = { kind: "browser", data: localData, rendering: browserRendering, chat: browserChat };

export function BrowserLayout({ children }: { children: React.ReactNode }) {
  return (
    <BrowserTRPCProvider>
      <EditionProvider value={BROWSER_EDITION}>
        <WorkspaceProvider>
          <AppShell>{children}</AppShell>
        </WorkspaceProvider>
      </EditionProvider>
    </BrowserTRPCProvider>
  );
}

export function NotFound() {
  return (
    <>
      <PageHeader title="Page not found" />
      <EmptyState
        title="Nothing at this address"
        body="The link may point to a page that no longer exists, or to a project deleted from this browser."
        cta={{ label: "Back to the dashboard", href: "/dashboard" }}
      />
    </>
  );
}
