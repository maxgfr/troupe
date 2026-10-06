"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { ChevronDownIcon } from "~/app/_components/icons";
import { statusChipBase } from "~/app/_components/ui";
import { clock, KIND_LABELS, STATUS_LABELS, type ItemKind, type ItemStatus } from "./format";

export interface LibraryRow {
  id: string;
  kind: ItemKind;
  title: string;
  sourceUrl: string | null;
  fileName: string | null;
  thumbnailUrl: string | null;
  durationS: number | null;
  mine: boolean;
  status: ItemStatus;
  stage: string | null;
  problem: string | null;
  tags: string[];
  hook: string | null;
  createdAt: Date | string;
}

const STATUS_TONES: Record<ItemStatus, string> = {
  queued: "bg-fg/[0.07] text-muted",
  analyzing: "bg-primary/15 text-primary",
  ready: "bg-success/15 text-success",
  failed: "bg-danger/15 text-danger",
};

export function ItemStatusChip({ status, stage }: { status: ItemStatus; stage?: string | null }) {
  return (
    <span title={status === "analyzing" && stage ? stage : undefined} className={`${statusChipBase} ${STATUS_TONES[status]}`}>
      {status === "analyzing" ? <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" /> : null}
      {STATUS_LABELS[status]}
      {status === "analyzing" && stage ? <span className="sr-only">: {stage}</span> : null}
    </span>
  );
}

// One glyph per kind, for items without a picture (texts, articles, PDFs,
// sound), drawn at the same 1.6 stroke as the studio's icons (icons.tsx).
const KIND_GLYPHS: Record<ItemKind, React.ReactNode> = {
  video: <path d="M8 6.5v7l5.5-3.5z" fill="currentColor" stroke="none" />,
  audio: <path d="M5 9v2M7.5 7v6M10 5v10M12.5 7.5v5M15 9v2" />,
  image: (
    <>
      <rect x="4" y="5" width="12" height="10" rx="1.5" />
      <path d="m5 13 3.5-3.5 2.5 2.5 1.5-1.5 2.5 2.5" />
    </>
  ),
  pdf: (
    <>
      <path d="M6 3.5h5.5L14.5 6.5v10h-8.5z" />
      <path d="M11.5 3.5v3h3M8.5 10h4M8.5 12.5h4" />
    </>
  ),
  text: <path d="M5 6h10M5 9h10M5 12h10M5 15h6" />,
  article: (
    <>
      <rect x="4.5" y="4" width="11" height="12" rx="1.5" />
      <path d="M7 7.5h6M7 10h6M7 12.5h3.5" />
    </>
  ),
};

// The picture of an item: its first frame or the image itself, else the
// kind's glyph on the surface tint.
export function Thumb({ row, className = "size-12" }: { row: Pick<LibraryRow, "thumbnailUrl" | "kind">; className?: string }) {
  if (row.thumbnailUrl) {
    // biome-ignore lint/performance/noImgElement: the browser edition has no next/image; frames are small JPEGs the studio already sized.
    return <img src={row.thumbnailUrl} alt="" loading="lazy" decoding="async" className={`${className} shrink-0 rounded-lg object-cover outline outline-1 -outline-offset-1 outline-[var(--picture-edge)]`} />;
  }
  return (
    <span aria-hidden className={`${className} flex shrink-0 items-center justify-center rounded-lg bg-surface text-muted`}>
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="size-5">
        {KIND_GLYPHS[row.kind]}
      </svg>
    </span>
  );
}

const sourceOf = (row: LibraryRow) => {
  if (row.sourceUrl) {
    try {
      return new URL(row.sourceUrl).hostname.replace(/^www\./, "");
    } catch {
      return row.sourceUrl;
    }
  }
  return row.fileName ?? (row.kind === "text" ? "pasted" : "");
};

type SortKey = "createdAt" | "title" | "durationS";

function SortHeader({ label, column, sort, onSort, className = "" }: { label: string; column: SortKey; sort: { key: SortKey; desc: boolean }; onSort: (key: SortKey) => void; className?: string }) {
  const active = sort.key === column;
  return (
    <th scope="col" aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"} className={`px-3 py-2 font-medium ${className}`}>
      <button type="button" onClick={() => onSort(column)} className={`-mx-1 inline-flex items-center gap-1 rounded px-1 transition-colors duration-150 hover:text-fg ${active ? "text-fg" : ""}`}>
        {label}
        <ChevronDownIcon className={`size-3 transition-transform duration-150 ${active ? "opacity-100" : "opacity-0"} ${active && !sort.desc ? "rotate-180" : ""}`} />
      </button>
    </th>
  );
}

// The library as a ledger: what was saved, sortable by when, title or
// length, filtered by kind, "my own" and tag. Phones read two-line rows.
export function LibraryTable({ rows, tag, onTag }: { rows: LibraryRow[]; tag: string | null; onTag: (tag: string | null) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "createdAt", desc: true });
  const sorted = useMemo(() => {
    const value = (r: LibraryRow) => (sort.key === "createdAt" ? new Date(r.createdAt).getTime() : sort.key === "title" ? r.title.toLowerCase() : (r.durationS ?? -1));
    return [...rows].sort((a, b) => {
      const [x, y] = [value(a), value(b)];
      const order = x < y ? -1 : x > y ? 1 : 0;
      return sort.desc ? -order : order;
    });
  }, [rows, sort]);
  const onSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "title" }));

  return (
    <div className="overflow-hidden rounded-2xl shadow-[inset_0_0_0_1px_var(--troupe-color-line)]">
      <table className="w-full table-fixed border-collapse text-left text-sm max-md:hidden">
        <caption className="sr-only">Your saved items</caption>
        <colgroup>
          <col />
          <col className="w-[4.5rem]" />
          <col className="w-[10rem] max-xl:w-[7.5rem]" />
          <col className="w-[6.5rem]" />
          <col className="w-[5.5rem]" />
        </colgroup>
        <thead className="border-b border-line bg-surface/50 text-xs text-muted">
          <tr>
            <SortHeader label="Item" column="title" sort={sort} onSort={onSort} className="pl-4" />
            <SortHeader label="Length" column="durationS" sort={sort} onSort={onSort} className="text-right" />
            <th scope="col" className="px-3 py-2 font-medium">Tags</th>
            <SortHeader label="Added" column="createdAt" sort={sort} onSort={onSort} />
            <th scope="col" className="px-3 py-2 pr-4 text-right font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sorted.map((row) => (
            <tr key={row.id} className="group transition-colors duration-150 hover:bg-fg/[0.03]">
              <td className="py-2.5 pr-3 pl-4">
                <div className="flex items-center gap-3">
                  <Thumb row={row} />
                  <div className="min-w-0">
                    <Link href={`/library/${row.id}`} className="block truncate font-medium hover:text-primary">
                      {row.title}
                    </Link>
                    <p className="truncate text-xs text-muted">
                      {row.mine ? <span className="mr-1.5 rounded-full bg-fg/[0.07] px-1.5 py-px text-[11px] text-fg">mine</span> : null}
                      {KIND_LABELS[row.kind]} · {row.hook ? `“${row.hook}”` : sourceOf(row)}
                    </p>
                  </div>
                </div>
              </td>
              <td className="px-3 py-2.5 text-right font-mono text-xs whitespace-nowrap tabular-nums text-muted">{clock(row.durationS) || "—"}</td>
              <td className="px-3 py-2.5">
                <div className="flex flex-wrap gap-1">
                  {row.tags.slice(0, 2).map((t) => (
                    <button key={t} type="button" onClick={() => onTag(tag === t ? null : t)} aria-pressed={tag === t} title={`Only items tagged ${t}`} className={`relative flex max-w-full rounded-full px-2 py-0.5 text-xs transition-colors duration-150 after:absolute after:-inset-y-2.5 after:inset-x-0 ${tag === t ? "bg-primary/15 text-primary" : "bg-fg/[0.07] text-muted hover:text-fg"}`}>
                      <span className="truncate whitespace-nowrap">{t}</span>
                    </button>
                  ))}
                </div>
              </td>
              <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap tabular-nums text-muted">{new Date(row.createdAt).toLocaleDateString()}</td>
              <td className="px-3 py-2.5 pr-4 text-right">
                <ItemStatusChip status={row.status} stage={row.stage} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="divide-y divide-line md:hidden">
        {sorted.map((row) => (
          <li key={row.id}>
            <Link href={`/library/${row.id}`} className="flex items-center gap-3 px-3 py-3 transition-colors duration-150 hover:bg-fg/[0.03]">
              <Thumb row={row} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{row.title}</p>
                <p className="mt-0.5 truncate font-mono text-xs tabular-nums text-muted">
                  {KIND_LABELS[row.kind]}
                  {row.durationS ? ` · ${clock(row.durationS)}` : ""}
                  {row.mine ? " · mine" : ""}
                  {row.tags.length ? ` · ${row.tags.slice(0, 2).join(", ")}` : ""}
                </p>
              </div>
              <ItemStatusChip status={row.status} stage={row.stage} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
