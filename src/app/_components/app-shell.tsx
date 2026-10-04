"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { DemoBanner, ResetDemoData, useEdition } from "./edition";
import { Wordmark } from "./wordmark";
import { useWorkspace } from "./workspace-context";
import { ErrorNote } from "./ui";

// Personal studio navigation. Project tools stay within each project.
const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/actors", label: "Actors" },
  { href: "/benchmark", label: "Benchmark" },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const workspace = useWorkspace();
  const edition = useEdition();

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-on-primary">Skip to content</a>
      {edition.kind === "demo" ? <DemoBanner /> : null}
      <header className="sticky top-0 z-20 border-b border-muted/20 bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-3 sm:gap-8">
            <Wordmark href="/dashboard" />
            <nav aria-label="Primary" className="flex items-center gap-1">
              {NAV.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`rounded-lg px-3 py-1.5 text-sm transition-colors duration-150 ${
                      active
                        ? "bg-primary/15 font-medium text-primary"
                        : "text-muted hover:text-fg"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/settings"
              className="rounded-lg px-3 py-1.5 text-sm text-muted transition-colors duration-150 hover:text-fg"
            >
              {workspace.status === "ready" ? workspace.workspaceName : "Settings"}
            </Link>
          </div>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        {workspace.status === "error" || workspace.status === "empty" ? (
          <div className="space-y-4">
            <ErrorNote>{workspace.status === "error" ? `The studio could not load: ${workspace.message}` : "The personal studio could not be initialized."}</ErrorNote>
            <button type="button" onClick={() => window.location.reload()} className="rounded-lg bg-primary px-4 py-2 text-sm text-on-primary">Reload studio</button>
            {edition.kind === "demo" ? (
              <div className="space-y-2 border-t border-muted/15 pt-4">
                <p className="max-w-[72ch] text-sm text-muted">If reloading does not help, the data saved in this browser may be damaged. Resetting starts an empty studio.</p>
                <ResetDemoData resetData={edition.resetData} />
              </div>
            ) : null}
          </div>
        ) : children}
      </main>
    </div>
  );
}
