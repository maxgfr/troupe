"use client";

import { useEffect, useId, useState } from "react";

import { useEdition } from "~/app/_components/edition";
import { useMediaQuery } from "~/app/_components/use-media-query";
import { useWorkspace } from "~/app/_components/workspace-context";
import { EmptyState, ErrorNote, PageHeader, Section, SignedOutNotice, SkeletonRows } from "~/app/_components/ui";
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

const SearchIcon = () => (
  <svg aria-hidden viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted">
    <circle cx="8.5" cy="8.5" r="5.5" />
    <path d="m13 13 4 4" />
  </svg>
);

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
    { enabled: ready && status.isSuccess, refetchInterval: (q) => (q.state.data?.some((i) => i.status === "queued" || i.status === "analyzing") ? 2000 : false) },
  );
  const uploader = edition.kind === "browser" ? edition.library : serverUploader;
  const filtered = Boolean(kind || onlyMine || tag);

  if (workspace.status === "unauthenticated") return <SignedOutNotice />;

  const chat = ready && status.isSuccess ? <LibraryChat workspaceId={workspaceId} /> : null;

  return (
    <>
      <PageHeader title="Library" lede="Videos, posts and articles you saved for inspiration, read by your own models. Search them by meaning, ask about them, and turn what works into scripts." />

      {workspace.status === "loading" || (ready && status.isPending) ? (
        <SkeletonRows rows={4} />
      ) : workspace.status === "error" ? (
        <ErrorNote>{workspace.message}</ErrorNote>
      ) : status.error ? (
        <EmptyState title="The library is off" body={`${status.error.message} Set TROUPE_LIBRARY=1 (docs/LIBRARY.md) to turn it on.`} />
      ) : status.data && uploader ? (
        <>
          <div className="mb-6 space-y-3">
            <AddBar workspaceId={workspaceId} uploader={uploader} canFetchLinks={status.data.edition === "self-hosted"} maxUploadBytes={status.data.maxUploadBytes} onAdded={() => setQuery("")} />
            {uploader.Note ? <uploader.Note /> : null}
            <ToolStatus tools={status.data.tools} />
          </div>

          <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)] lg:items-start lg:gap-8">
            <div className="min-w-0 space-y-10">
              <section aria-label="Saved items" className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[12rem] flex-1">
                    <label htmlFor={searchId} className="sr-only">
                      Search your library
                    </label>
                    <SearchIcon />
                    <input
                      id={searchId}
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setQuery("");
                      }}
                      placeholder="Search by meaning: hooks that ask a question…"
                      className="min-h-10 w-full rounded-lg border border-muted/30 bg-bg py-2 pr-3 pl-9 text-sm placeholder:text-muted/80"
                    />
                  </div>
                  {searching ? null : (
                    <>
                      <label htmlFor={kindId} className="sr-only">
                        Kind
                      </label>
                      <select id={kindId} value={kind} onChange={(e) => setKind(e.target.value as ItemKind | "")} className="min-h-10 rounded-lg border border-muted/30 bg-bg px-3 text-sm">
                        <option value="">All kinds</option>
                        {(Object.keys(KIND_LABELS) as ItemKind[]).map((k) => (
                          <option key={k} value={k}>
                            {KIND_LABELS[k]}
                          </option>
                        ))}
                      </select>
                      <label className="flex min-h-10 items-center gap-2 rounded-lg border border-muted/30 px-3 text-sm">
                        <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} className="size-4 accent-[var(--troupe-color-primary)]" />
                        Mine
                      </label>
                    </>
                  )}
                </div>
                {tag && !searching ? (
                  <p className="text-xs text-muted">
                    Tagged <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-primary">{tag}</span>{" "}
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
                    <p className="rounded-xl border border-muted/20 px-4 py-6 text-sm text-muted">Nothing here matches these filters.</p>
                  ) : (
                    <EmptyState
                      title="Save your first piece"
                      body={
                        status.data.edition === "self-hosted"
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

              {!wide && chat ? <section className="border-t border-muted/20 pt-6">{chat}</section> : null}
            </div>
            {wide && chat ? (
              <aside aria-label="Ask your library" className="sticky top-24 h-[calc(100dvh-8rem)] min-h-[28rem] border-l border-muted/20 pl-6">
                {chat}
              </aside>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
