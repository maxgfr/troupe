"use client";

import { useEffect, useRef, useState } from "react";

import { errorText } from "~/app/_components/errors";
import { CheckIcon, CloseIcon, DownloadIcon, ReuseIcon, SearchIcon, StarIcon } from "~/app/_components/icons";
import { Button, ErrorNote, ProviderWarning, SkeletonRows, buttonClass, fieldClass } from "~/app/_components/ui";
import { api } from "~/trpc/react";
import { ProviderAccounts, type ProviderAccountId } from "../settings/provider-accounts";
import { matchModels } from "./shot-settings";
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

// Every provider account at once, from the Shots page: add, replace, test or
// remove a key without leaving the shot being described.
export function KeysDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal labelledBy="keys-title" onClose={onClose} className="w-[min(38rem,calc(100vw-2rem))]">
      <div className="max-h-[85dvh] overflow-y-auto p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id="keys-title" className="font-display text-xl font-semibold tracking-[-0.01em]">
            API keys
          </h2>
          <CloseButton onClose={onClose} />
        </div>
        <ProviderAccounts />
      </div>
    </Modal>
  );
}

// fal.ai's text-to-video catalog, live: search it and add a model to the
// studio in one click; its settings come from its own schema.
export function FalCatalogDialog({
  onClose,
  onAdded,
  hasKey,
  onAskKey,
}: {
  onClose: () => void;
  // The model added (or already there), to tick it in the composer.
  onAdded: (modelKey: string) => void;
  hasKey: boolean;
  onAskKey: () => void;
}) {
  const utils = api.useUtils();
  const [query, setQuery] = useState("");
  const catalog = api.settings.models.falCatalog.useQuery(undefined, { staleTime: 10 * 60_000, retry: false });
  const add = api.settings.models.addFal.useMutation({
    onSuccess: async ({ modelKey }) => {
      await Promise.all([
        utils.shots.models.invalidate(),
        utils.settings.models.list.invalidate(),
        utils.settings.models.falCatalog.invalidate(),
        utils.studio.modelOptions.invalidate(),
      ]);
      onAdded(modelKey);
    },
  });
  const shown = matchModels(
    (catalog.data ?? []).map((m) => ({ ...m, key: m.endpoint, vendor: m.owner })),
    query,
  ).slice(0, 60);

  return (
    <Modal labelledBy="fal-title" onClose={onClose} className="w-[min(40rem,calc(100vw-2rem))]">
      <div className="flex max-h-[85dvh] flex-col p-6">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h2 id="fal-title" className="font-display text-xl font-semibold tracking-[-0.01em]">
              Models on fal.ai
            </h2>
            <p className="mt-1 text-sm text-pretty text-muted">
              Every text-to-video model fal.ai offers today. Added models render on your fal.ai key, with the settings
              each one takes.
            </p>
          </div>
          <CloseButton onClose={onClose} />
        </div>
        {hasKey ? null : (
          <div className="mb-3">
            <ProviderWarning>
              They need a fal.ai key to render.{" "}
              <button
                type="button"
                onClick={onAskKey}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Add your key
              </button>
            </ProviderWarning>
          </div>
        )}
        <label className="relative block">
          <span className="sr-only">Search fal.ai's models</span>
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Kling, Seedance, Wan, Veo…"
            className={`${fieldClass} pl-9`}
          />
        </label>
        {catalog.error ? (
          <div className="mt-3">
            <ErrorNote>{errorText(catalog.error)}</ErrorNote>
          </div>
        ) : null}
        {add.error ? (
          <div className="mt-3">
            <ErrorNote>{errorText(add.error)}</ErrorNote>
          </div>
        ) : null}
        <ul aria-label="fal.ai models" className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {catalog.isPending ? (
            <li>
              <SkeletonRows rows={5} />
            </li>
          ) : shown.length === 0 ? (
            <li className="px-1 py-3 text-sm text-muted">No model matches.</li>
          ) : (
            shown.map((m) => {
              const adding = add.isPending && add.variables?.endpoint === m.endpoint;
              return (
                <li key={m.endpoint} className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.label}</p>
                    <p className="truncate font-mono text-xs text-muted">{m.endpoint}</p>
                  </div>
                  {m.modelKey ? (
                    <Button size="sm" variant="quiet-primary" onClick={() => onAdded(m.modelKey!)}>
                      <CheckIcon className="size-4" />
                      Use
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={add.isPending}
                      onClick={() => add.mutate({ endpoint: m.endpoint })}
                    >
                      {adding ? "Adding…" : "Add"}
                    </Button>
                  )}
                </li>
              );
            })
          )}
        </ul>
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
