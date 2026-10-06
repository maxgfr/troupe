"use client";

import Link from "next/link";

import { ErrorNote, SkeletonRows } from "~/app/_components/ui";
import { api } from "~/trpc/react";
import { clock, KIND_LABELS, type ItemKind } from "./format";
import { Thumb } from "./library-table";

// The passages closest to the query, each opening its item at its moment.
export function SearchResults({ workspaceId, query }: { workspaceId: string; query: string }) {
  const search = api.library.search.useQuery(
    { workspaceId, query, limit: 20 },
    { placeholderData: (previous) => previous, retry: false },
  );
  if (search.isPending) return <SkeletonRows rows={3} />;
  if (search.error) return <ErrorNote>The search failed: {search.error.message}</ErrorNote>;
  const { hits, mode, note } = search.data;
  return (
    <div className="space-y-3" aria-live="polite">
      <p className="text-xs text-muted">
        {hits.length === 0 ? "Nothing matches." : `${hits.length} passage${hits.length === 1 ? "" : "s"}, `}
        {hits.length > 0 ? (mode === "semantic" ? "closest in meaning first." : "matched by their words.") : null}
        {note ? ` ${note}` : null}
      </p>
      {hits.length > 0 ? (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl shadow-[inset_0_0_0_1px_var(--troupe-color-line)]">
          {hits.map((hit) => (
            <li key={hit.chunkId}>
              <Link
                href={`/library/${hit.itemId}${hit.startS !== null ? `?t=${Math.floor(hit.startS)}` : ""}`}
                className="flex gap-3 px-3 py-3 transition-colors duration-150 hover:bg-fg/[0.03] sm:px-4"
              >
                <Thumb row={{ thumbnailUrl: hit.thumbnailUrl, kind: hit.kind as ItemKind }} className="size-10" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-medium">{hit.title}</span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                      {hit.startS !== null ? clock(hit.startS) : KIND_LABELS[hit.kind as ItemKind]}
                    </span>
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-pretty text-sm text-muted">{hit.text}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
