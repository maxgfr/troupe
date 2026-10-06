import { Suspense } from "react";

import { AppShell } from "~/app/_components/app-shell";
import { EditionProvider, type Edition } from "~/app/_components/edition";
import { usePageTitle } from "~/app/_components/page-title";
import { EmptyState, PageHeader, SkeletonRows } from "~/app/_components/ui";
import { WorkspaceProvider } from "~/app/_components/workspace-context";
import { browserChat } from "./chat/ui";
import { localData } from "./data/local-data";
import { browserLibrary } from "./library/uploader";
import { browserRendering } from "./render/ui";
import { BrowserTRPCProvider } from "./trpc";

// src/app/(app)/layout.tsx for the browser edition: the same shell around the
// same pages, with the router and database of this browser behind them.

const BROWSER_EDITION: Edition = { kind: "browser", data: localData, rendering: browserRendering, chat: browserChat, library: browserLibrary };

export function BrowserLayout({ children }: { children: React.ReactNode }) {
  return (
    <BrowserTRPCProvider>
      <EditionProvider value={BROWSER_EDITION}>
        <WorkspaceProvider>
          <AppShell>
            {/* While a page's code loads, the shape of a page. */}
            <Suspense fallback={<SkeletonRows rows={4} />}>{children}</Suspense>
          </AppShell>
        </WorkspaceProvider>
      </EditionProvider>
    </BrowserTRPCProvider>
  );
}

export function NotFound() {
  usePageTitle("Page not found");
  return (
    <>
      <PageHeader title="Page not found" />
      <EmptyState
        title="Nothing at this address"
        body="The link may point to a page that no longer exists, or to a project deleted from this browser."
        cta={{ label: "Back to your projects", href: "/dashboard" }}
      />
    </>
  );
}
