"use client";

import { useEffect, useId, useState } from "react";

import { useEdition } from "~/app/_components/edition";
import { useMediaQuery } from "~/app/_components/use-media-query";
import { useWorkspace } from "~/app/_components/workspace-context";
import { SearchIcon } from "~/app/_components/icons";
import { EmptyState, ErrorNote, PageHeader, Section, SignedOutNotice, Skeleton, SkeletonRows, chipClass, fieldClass } from "~/app/_components/ui";
import { api } from "~/trpc/react";
import { AddBar } from "./add-bar";
import { KIND_LABELS, type ItemKind } from "./format";
import { IdeaCards } from "./idea-cards";
import { LibraryChat } from "./library-chat";
import { LibraryTable, type LibraryRow } from "./library-table";
import { SearchResults } from "./search-results";
import { ToolStatus } from "./tool-status";
import { serverUploader } from "./upload";

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

// The inspiration library: save, search, ask, and turn what works into ideas.
export default function LibraryPage() {
  const workspace = useWorkspace();
  const edition = useEdition();
  const wide = useMediaQuery("(min-width: 1024px)");
  const searchId = useId();
  const kindId = useId();
  const ready = workspace.status === "ready";
  const workspaceId = workspace.workspaceId ?? "";
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<ItemKind | "">("");
  const [onlyMine, setOnlyMine] = useState(false);
  const [tag, setTag] = useState<string | null>(null);
  const searching = useDebounced(query.trim(), 300);

  const status = api.library.status.useQuery(undefined, { enabled: ready, retry: false, staleTime: 30_000 });
  const items = api.library.list.useQuery(
    { workspaceId, ...(kind ? { kind } : {}), ...(onlyMine ? { mine: true } : {}), ...(tag ? { tag } : {}) },
    { enabled: ready, refetchInterval: (q) => (q.state.data?.some((i) => i.status === "queued" || i.status === "analyzing") ? 2000 : false) },
  );
  const uploader = edition.kind === "browser" ? edition.library : serverUploader;
  const filtered = Boolean(kind || onlyMine || tag);

  if (workspace.status === "unauthenticated") return <SignedOutNotice />;

  const chat = ready && !status.error ? <LibraryChat workspaceId={workspaceId} /> : null;

  return (
    <>
      <PageHeader title="Library" lede="Videos, posts and articles you saved for inspiration, read by your own models. Search them by meaning, ask about them, and turn what works into scripts." />

      {workspace.status === "loading" ? (
        <SkeletonRows rows={4} />
      ) : workspace.status === "error" ? (
        <ErrorNote>{workspace.message}</ErrorNote>
      ) : status.error ? (
        <EmptyState
          title={edition.kind === "self-hosted" ? "The library is off" : "The library could not start"}
          body={
            edition.kind === "self-hosted"
              ? `${status.error.message} Set TROUPE_LIBRARY=1 in the studio's environment (docs/LIBRARY.md) to turn it on.`
              : `${status.error.message} Reload the page; if it keeps failing, this browser may be blocking the storage the library needs (site data for this page).`
          }
        />
      ) : uploader ? (
        <>
          <div className="mb-6 space-y-3">
            {status.data ? (
              <>
                <AddBar workspaceId={workspaceId} uploader={uploader} canFetchLinks={status.data.edition === "self-hosted"} maxUploadBytes={status.data.maxUploadBytes} onAdded={() => setQuery("")} />
                {uploader.Note ? <uploader.Note /> : null}
                <ToolStatus tools={status.data.tools} />
              </>
            ) : (
              <div role="status" aria-label="Loading the library's tools" className="space-y-3">
                <Skeleton className="h-[5.5rem] w-full rounded-xl" />
                <Skeleton className="h-4 w-80 max-w-full" />
              </div>
            )}
          </div>

          <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)] lg:items-start lg:gap-10">
            <div className="min-w-0 space-y-10">
              <section aria-label="Saved items" className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[12rem] flex-1">
                    <label htmlFor={searchId} className="sr-only">
                      Search your library
                    </label>
                    <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
                    <input
                      id={searchId}
                      type="search"
                      data-shortcut="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setQuery("");
                      }}
                      placeholder="Search by meaning…"
                      className={`${fieldClass} min-h-10 pl-9`}
                    />
                  </div>
                  {searching ? null : (
                    <>
                      <label htmlFor={kindId} className="sr-only">
                        Kind
                      </label>
                      <select data-field id={kindId} value={kind} onChange={(e) => setKind(e.target.value as ItemKind | "")} className={`${fieldClass} min-h-10 w-auto`}>
                        <option value="">All kinds</option>
                        {(Object.keys(KIND_LABELS) as ItemKind[]).map((k) => (
                          <option key={k} value={k}>
                            {KIND_LABELS[k]}
                          </option>
                        ))}
                      </select>
                      <label className={chipClass(onlyMine, "min-h-10 rounded-lg")}>
                        <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} className="size-4 accent-[var(--troupe-color-primary)]" />
                        Mine
                      </label>
                    </>
                  )}
                </div>
                {tag && !searching ? (
                  <p className="text-xs text-muted">
                    Tagged <span className="rounded-full bg-primary/15 px-2 py-0.5 text-primary">{tag}</span>{" "}
                    <button type="button" onClick={() => setTag(null)} className="ml-1 min-h-8 rounded px-1 text-primary underline-offset-4 hover:underline">
                      Show all
                    </button>
                  </p>
                ) : null}

                {searching ? (
                  <SearchResults workspaceId={workspaceId} query={searching} />
                ) : items.isPending ? (
                  <SkeletonRows rows={4} />
                ) : items.error ? (
                  <ErrorNote>The library failed to load: {items.error.message}</ErrorNote>
                ) : items.data.length === 0 ? (
                  filtered ? (
                    <p className="rounded-2xl bg-surface/70 px-5 py-8 text-center text-sm text-muted">Nothing here matches these filters.</p>
                  ) : (
                    <EmptyState
                      title="Save your first piece"
                      body={
                        edition.kind === "self-hosted"
                          ? "Paste a link to a short video or an article, paste a text, or drop a file above. Troupe transcribes it, looks at its pictures, finds its hook and makes it searchable."
                          : "Paste a text or drop a video above. Troupe transcribes it in this tab, finds its hook and makes it searchable, all in this browser."
                      }
                    />
                  )
                ) : (
                  <LibraryTable rows={items.data as LibraryRow[]} tag={tag} onTag={setTag} />
                )}
              </section>

              <Section title="Ideas" className="mb-0">
                <IdeaCards workspaceId={workspaceId} empty="Open a saved item and ask for ideas in its style, a remix of its hook or a script for one of your actors. Each idea becomes a project in one click." />
              </Section>

              {!wide && chat ? <section className="border-t border-line pt-6">{chat}</section> : null}
            </div>
            {wide && chat ? (
              <aside aria-label="Ask your library" className="sticky top-24 h-[calc(100dvh-8rem)] max-h-[48rem] min-h-[28rem] border-l border-line pl-6">
                {chat}
              </aside>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
