"use client";

import { useEffect, useRef, useState } from "react";

import { CloseIcon, DownloadIcon, ReuseIcon, StarIcon } from "~/app/_components/icons";
import { Button, buttonClass } from "~/app/_components/ui";
import { ProviderAccounts, type ProviderAccountId } from "../settings/provider-accounts";
import type { Shot } from "./types";

// A native modal dialog, the way the shortcuts list opens one: Escape and a
// click on the backdrop close it.
function Modal({
  labelledBy,
  onClose,
  className = "",
  children,
}: {
  labelledBy: string;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || node.open) return;
    // A browser without modal dialogs (and the tests' DOM) shows it in place.
    if (typeof node.showModal === "function") node.showModal();
    else node.setAttribute("open", "");
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={`m-auto rounded-2xl bg-raised p-0 text-fg shadow-overlay backdrop:bg-black/60 backdrop:backdrop-blur-[2px] ${className}`}
    >
      {children}
    </dialog>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      className="-mt-1 -mr-2 flex size-10 shrink-0 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-fg/[0.06] hover:text-fg"
    >
      <CloseIcon className="size-4" />
    </button>
  );
}

// A model was chosen without its key: ask for it there, then carry on.
export function KeyDialog({
  provider,
  modelLabel,
  onClose,
}: {
  provider: ProviderAccountId;
  modelLabel: string;
  onClose: () => void;
}) {
  return (
    <Modal labelledBy="key-title" onClose={onClose} className="w-[min(34rem,calc(100vw-2rem))]">
      <div className="p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="key-title" className="font-display text-xl font-semibold tracking-[-0.01em]">
              Add a key for {modelLabel}
            </h2>
            <p className="mt-1 text-sm text-muted">It is saved for every model of this provider account.</p>
          </div>
          <CloseButton onClose={onClose} />
        </div>
        <ProviderAccounts only={provider} onSaved={onClose} />
      </div>
    </Modal>
  );
}

// A finished shot, full size, with what made it.
export function ShotViewer({
  shot,
  onClose,
  onReuse,
  onFavorite,
}: {
  shot: Shot;
  onClose: () => void;
  onReuse: () => void;
  onFavorite: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const made = new Date(shot.createdAt);
  return (
    <Modal labelledBy="viewer-title" onClose={onClose} className="w-[min(64rem,calc(100vw-2rem))]">
      <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex items-center justify-center bg-black md:rounded-l-2xl">
          {shot.videoUrl ? (
            <video
              src={shot.videoUrl}
              controls
              autoPlay
              playsInline
              loop
              className="max-h-[80dvh] w-full object-contain"
            />
          ) : null}
        </div>
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id="viewer-title" className="font-display text-lg font-semibold tracking-[-0.01em]">
              {shot.modelLabel}
            </h2>
            <CloseButton onClose={onClose} />
          </div>
          <div>
            <p className="max-h-48 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap text-pretty">
              {shot.prompt}
            </p>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(shot.prompt).then(() => setCopied(true));
              }}
              className="mt-1 min-h-8 text-xs text-primary underline-offset-4 hover:underline"
            >
              {copied ? "Copied" : "Copy the text"}
            </button>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            <dt className="text-muted">Format</dt>
            <dd className="font-mono">{shot.aspectRatio}</dd>
            <dt className="text-muted">Length</dt>
            <dd className="font-mono">
              {shot.videoDurationS ? `${shot.videoDurationS.toFixed(1)} s` : `${shot.durationS} s`}
            </dd>
            <dt className="text-muted">Resolution</dt>
            <dd className="font-mono">{shot.resolution}</dd>
            {shot.costUsd != null ? (
              <>
                <dt className="text-muted">Cost</dt>
                <dd className="font-mono">
                  ${Number(shot.costUsd).toFixed(2)}
                  {shot.costSource === "estimate" ? " est." : ""}
                </dd>
              </>
            ) : null}
            <dt className="text-muted">Made</dt>
            <dd>
              <time dateTime={made.toISOString()}>{made.toLocaleString()}</time>
            </dd>
          </dl>
          <div className="mt-auto flex flex-wrap gap-2">
            <Button variant="primary" size="sm" onClick={onReuse}>
              <ReuseIcon className="size-4" />
              Recreate
            </Button>
            <Button size="sm" aria-pressed={shot.favorite} onClick={onFavorite}>
              <StarIcon filled={shot.favorite} className="size-4" />
              {shot.favorite ? "Favorite" : "Add to favorites"}
            </Button>
            {shot.downloadUrl ? (
              <a href={shot.downloadUrl} className={buttonClass({ size: "sm", variant: "quiet" })}>
                <DownloadIcon className="size-4" />
                Download
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </Modal>
  );
}
