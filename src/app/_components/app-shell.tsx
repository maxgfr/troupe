"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { useEdition } from "./edition";
import { ActorsIcon, CompareIcon, LibraryIcon, PlusIcon, ProjectsIcon, SettingsIcon } from "./icons";
import { DeleteLocalData } from "./local-data";
import { Shortcuts } from "./shortcuts";
import { StageProvider } from "./stage";
import { Button, ButtonLink, ErrorNote } from "./ui";
import { Wordmark } from "./wordmark";
import { useWorkspace } from "./workspace-context";

// The studio's navigation (docs/PRODUCT-MAP.md): the four sections in the
// top bar, New project and Settings on its right. On phones the sections
// move to a tab bar at the bottom, within reach of a thumb, and the top bar
// keeps the wordmark, New project and Settings.
const NAV = [
  { href: "/dashboard", label: "Projects", Icon: ProjectsIcon, also: ["/projects"] },
  { href: "/library", label: "Library", Icon: LibraryIcon, also: [] },
  { href: "/actors", label: "Actors", Icon: ActorsIcon, also: [] },
  { href: "/benchmark", label: "Compare", Icon: CompareIcon, also: [] },
] as const;

function isActive(pathname: string, item: (typeof NAV)[number]): boolean {
  return [item.href, ...item.also].some((href) => pathname === href || pathname.startsWith(`${href}/`)) && pathname !== "/projects/new";
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const workspace = useWorkspace();
  const edition = useEdition();
  const settingsActive = pathname.startsWith("/settings");
  // The fade is for moving between pages, not for the first one: that one
  // paints at once.
  const shown = useRef<string | null>(null);
  const navigated = shown.current !== null && shown.current !== pathname;
  useEffect(() => {
    shown.current = pathname;
  }, [pathname]);

  return (
    <div className="relative isolate flex min-h-dvh flex-col">
      <StageProvider>
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-on-primary">
          Skip to content
        </a>
        <header className="sticky top-0 z-30 bg-bg/75 shadow-[0_1px_0_var(--troupe-color-line)] backdrop-blur-xl backdrop-saturate-150">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:h-16 sm:px-6">
            <div className="flex min-w-0 items-center gap-6 lg:gap-8">
              <Wordmark href="/dashboard" />
              <nav aria-label="Primary" className="flex items-center gap-1 max-sm:hidden">
                {NAV.map((item) => {
                  const active = isActive(pathname, item);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`flex min-h-10 items-center rounded-lg px-3 text-sm font-medium transition-colors duration-150 ${
                        active ? "bg-fg/[0.08] text-fg" : "text-muted hover:text-fg"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
            <div className="flex items-center gap-1 sm:gap-2">
              <ButtonLink href="/projects/new" variant="primary" size="sm" className="max-sm:size-10 max-sm:px-0">
                <PlusIcon className="size-4" />
                <span className="max-sm:sr-only">New project</span>
              </ButtonLink>
              <Link
                href="/settings"
                aria-current={settingsActive ? "page" : undefined}
                className={`flex min-h-10 min-w-10 items-center justify-center gap-2 rounded-lg px-2.5 text-sm font-medium transition-colors duration-150 sm:px-3 ${
                  settingsActive ? "bg-fg/[0.08] text-fg" : "text-muted hover:text-fg"
                }`}
              >
                <SettingsIcon className="size-[18px]" />
                {/* The name stays the link's accessible name on phones too. */}
                <span className="max-sm:sr-only">Settings</span>
              </Link>
            </div>
          </div>
        </header>

        <main id="main-content" tabIndex={-1} key={pathname} className={`${navigated ? "page-in " : ""}mx-auto w-full max-w-6xl flex-1 px-4 pt-8 pb-28 outline-none sm:px-6 sm:pt-10 sm:pb-16`}>
          {workspace.status === "error" || workspace.status === "empty" ? (
            <div className="max-w-2xl space-y-4">
              <ErrorNote>{workspace.status === "error" ? `The studio could not load: ${workspace.message}` : "The personal studio could not be initialized."}</ErrorNote>
              <Button variant="primary" onClick={() => window.location.reload()}>
                Reload studio
              </Button>
              {edition.kind === "browser" ? (
                <div className="space-y-2 border-t border-line pt-4">
                  <p className="max-w-[65ch] text-sm text-muted">If reloading does not help, the data saved in this browser may be damaged. Deleting it starts an empty studio.</p>
                  <DeleteLocalData deleteAll={edition.data.deleteAll} />
                </div>
              ) : null}
            </div>
          ) : (
            children
          )}
        </main>

        {/* Phones: the sections, at the bottom of the screen. */}
        <nav
          aria-label="Sections"
          className="fixed inset-x-0 bottom-0 z-30 bg-bg/85 pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_0_var(--troupe-color-line)] backdrop-blur-xl backdrop-saturate-150 sm:hidden"
        >
          <ul className="mx-auto grid max-w-md grid-cols-4">
            {NAV.map((item) => {
              const active = isActive(pathname, item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-150 ${active ? "text-fg" : "text-muted"}`}
                  >
                    <item.Icon className={`size-[22px] transition-colors duration-150 ${active ? "text-primary" : ""}`} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <Shortcuts />
      </StageProvider>
    </div>
  );
}
