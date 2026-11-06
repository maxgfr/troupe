"use client";

import { useRef, useState } from "react";

import { DownloadIcon, FilmIcon, ReuseIcon, StarIcon, TrashIcon } from "~/app/_components/icons";
import { Button, ProgressBar, StatusChip, chipClass } from "~/app/_components/ui";
import { VideoStill } from "~/app/_components/video-still";
import { cssRatio } from "./shot-settings";
import type { Shot } from "./types";

export type GalleryScope = "all" | "favorites";

const SCOPES: { id: GalleryScope; label: string }[] = [
  { id: "all", label: "All shots" },
  { id: "favorites", label: "Favorites" },
];

// All shots or the favorites: a tab rail the arrow keys move along.
export function ScopeTabs({ scope, onScope }: { scope: GalleryScope; onScope: (scope: GalleryScope) => void }) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div role="tablist" aria-label="Shots" className="flex gap-1">
      {SCOPES.map((s, i) => (
        <button
          key={s.id}
          ref={(node) => {
            tabs.current[i] = node;
          }}
          type="button"
          role="tab"
          id={`shots-tab-${s.id}`}
          aria-selected={scope === s.id}
          aria-controls="shots-gallery"
          tabIndex={scope === s.id ? 0 : -1}
          onClick={() => onScope(s.id)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
            event.preventDefault();
            const next = (i + (event.key === "ArrowRight" ? 1 : SCOPES.length - 1)) % SCOPES.length;
            onScope(SCOPES[next]!.id);
            tabs.current[next]?.focus();
          }}
          className={chipClass(scope === s.id, "", "sm")}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

// The shots as a masonry of their true formats, newest first.
export function Gallery({
  shots,
  onOpen,
  onReuse,
  onFavorite,
  onDelete,
  onRelaunch,
  relaunching,
}: {
  shots: Shot[];
  onOpen: (shot: Shot) => void;
  onReuse: (shot: Shot) => void;
  onFavorite: (shot: Shot) => void;
  onDelete: (shot: Shot) => void;
  onRelaunch: (shot: Shot) => void;
  relaunching: string | null;
}) {
  const live = shots.filter((s) => s.status === "queued" || s.status === "in_progress").length;
  return (
    <div id="shots-gallery" role="tabpanel">
      <p aria-live="polite" className="sr-only">
        {live ? `${live} ${live === 1 ? "shot is" : "shots are"} rendering.` : ""}
      </p>
      <ul className="columns-1 gap-4 min-[480px]:columns-2 lg:columns-3">
        {shots.map((shot) => (
          <li key={shot.id} className="mb-4 break-inside-avoid">
            <ShotTile
              shot={shot}
              onOpen={() => onOpen(shot)}
              onReuse={() => onReuse(shot)}
              onFavorite={() => onFavorite(shot)}
              onDelete={() => onDelete(shot)}
              onRelaunch={() => onRelaunch(shot)}
              relaunching={relaunching === shot.id}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

const iconButton =
  "flex size-9 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-fg/[0.06] hover:text-fg pointer-coarse:size-10";

function ShotTile({
  shot,
  onOpen,
  onReuse,
  onFavorite,
  onDelete,
  onRelaunch,
  relaunching,
}: {
  shot: Shot;
  onOpen: () => void;
  onReuse: () => void;
  onFavorite: () => void;
  onDelete: () => void;
  onRelaunch: () => void;
  relaunching: boolean;
}) {
  const [hover, setHover] = useState(false);
  const running = shot.status === "queued" || shot.status === "in_progress";
  const ratio = shot.width && shot.height ? `${shot.width} / ${shot.height}` : cssRatio(shot.aspectRatio);

  return (
    <article className="group rounded-2xl bg-surface/70 p-2" aria-label={shot.prompt.slice(0, 80)}>
      <div className="relative overflow-hidden rounded-xl" style={{ aspectRatio: ratio }}>
        {shot.status === "completed" && shot.videoUrl ? (
          <button
            type="button"
            onClick={onOpen}
            onPointerEnter={() => setHover(true)}
            onPointerLeave={() => setHover(false)}
            onFocus={() => setHover(true)}
            onBlur={() => setHover(false)}
            className="block size-full"
            aria-label="Open the shot"
          >
            <VideoStill
              src={shot.videoUrl}
              active={hover}
              className="size-full"
              fallback={
                <span className="flex size-full items-center justify-center bg-fg/[0.06] text-muted">
                  <FilmIcon className="size-6" />
                </span>
              }
            />
          </button>
        ) : running ? (
          <div className="flex size-full flex-col items-center justify-center gap-3 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--troupe-color-primary)_14%,transparent),transparent)] p-4">
            <div className="absolute inset-0 animate-pulse bg-fg/[0.03] motion-reduce:animate-none" aria-hidden />
            <ProgressBar
              label={shot.status === "queued" ? "Waiting for the model" : "Rendering"}
              figure={shot.progress != null ? `${Math.round(shot.progress * 100)}%` : null}
              fraction={shot.progress}
            />
          </div>
        ) : (
          <div className="flex size-full flex-col items-start justify-end gap-2 bg-danger/[0.06] p-4">
            <StatusChip status={shot.status} />
            <p className="line-clamp-4 text-sm text-pretty">
              {shot.errorDetail ?? "The model did not finish this shot."}
            </p>
            {shot.status === "failed" && !shot.relaunched ? (
              <Button size="sm" variant="outline" disabled={relaunching} onClick={onRelaunch}>
                {relaunching ? "Relaunching…" : "Relaunch"}
              </Button>
            ) : null}
          </div>
        )}
        {shot.favorite ? (
          <span className="pointer-events-none absolute top-2 right-2 rounded-full bg-black/55 p-1.5 text-white">
            <StarIcon filled className="size-3.5" />
            <span className="sr-only">Favorite</span>
          </span>
        ) : null}
      </div>

      <div className="px-1 pt-2">
        <p className="line-clamp-2 text-sm text-pretty">{shot.prompt}</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-xs text-muted">
            {shot.modelLabel} · <span className="font-mono">{shot.aspectRatio}</span> ·{" "}
            <span className="font-mono">{shot.durationS} s</span>
          </p>
          <div className="-mr-1 flex shrink-0 items-center">
            <button type="button" onClick={onReuse} aria-label="Reuse this shot" title="Reuse" className={iconButton}>
              <ReuseIcon className="size-4" />
            </button>
            {shot.status === "completed" ? (
              <button
                type="button"
                onClick={onFavorite}
                aria-pressed={shot.favorite}
                aria-label={shot.favorite ? "Remove from favorites" : "Add to favorites"}
                title={shot.favorite ? "Remove from favorites" : "Add to favorites"}
                className={`${iconButton} ${shot.favorite ? "text-primary hover:text-primary" : ""}`}
              >
                <StarIcon filled={shot.favorite} className="size-4" />
              </button>
            ) : null}
            {shot.downloadUrl ? (
              <a href={shot.downloadUrl} aria-label="Download" title="Download" className={iconButton}>
                <DownloadIcon className="size-4" />
              </a>
            ) : null}
            {running ? null : (
              <button
                type="button"
                onClick={onDelete}
                aria-label="Delete this shot"
                title="Delete"
                className={`${iconButton} hover:text-danger`}
              >
                <TrashIcon className="size-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
