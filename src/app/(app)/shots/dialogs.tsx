"use client";

import { useEffect, useRef, useState } from "react";

import { errorText } from "~/app/_components/errors";
import { CheckIcon, CloseIcon, DownloadIcon, ReuseIcon, SearchIcon, StarIcon } from "~/app/_components/icons";
import {
  Button,
  ErrorNote,
  ProviderWarning,
  SkeletonRows,
  buttonClass,
  chipClass,
  fieldClass,
} from "~/app/_components/ui";
import { api } from "~/trpc/react";
import { ProviderAccounts, type ProviderAccountId } from "../settings/provider-accounts";
import { matchModels, mediaPriceLabel, type ShotMedium } from "./shot-settings";
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

// The providers whose models the catalog lists, in tab order. fal.ai's comes
// from its own catalog (settings read from each endpoint's schema); the
// others from llm-models, rendered through llm-connect.
export const CATALOG_TABS = [
  { id: "openrouter", name: "OpenRouter" },
  { id: "gateway", name: "AI Gateway" },
  { id: "fal", name: "fal.ai" },
  { id: "xai", name: "xAI" },
  { id: "google", name: "Google" },
  { id: "replicate", name: "Replicate" },
  { id: "openai", name: "OpenAI" },
  { id: "elevenlabs", name: "ElevenLabs" },
] as const satisfies readonly { id: ProviderAccountId; name: string }[];
export type CatalogTab = (typeof CATALOG_TABS)[number]["id"];

// The tabs of each medium, in order.
const TABS_FOR: Record<ShotMedium, readonly CatalogTab[]> = {
  video: ["openrouter", "gateway", "fal", "xai", "google", "replicate"],
  image: ["openrouter", "gateway", "fal", "openai", "google", "xai", "replicate"],
  speech: ["gateway", "elevenlabs", "openai", "google", "fal"],
};

const TITLE: Record<ShotMedium, string> = { video: "Video models", image: "Photo models", speech: "Voice models" };

type CatalogVideoTab = "openrouter" | "gateway" | "google" | "xai" | "replicate";

const KEY_NAME: Record<CatalogTab, string> = {
  openrouter: "an OpenRouter",
  gateway: "a Vercel AI Gateway",
  fal: "a fal.ai",
  xai: "an xAI",
  google: "a Google AI",
  replicate: "a Replicate",
  openai: "an OpenAI",
  elevenlabs: "an ElevenLabs",
};

interface CatalogRow {
  id: string;
  name: string;
  owner: string;
  // "3–15 s · 16:9 9:16 · 720p · sound", when the list says.
  summary: string | null;
  // "$0.168/s", "$0.040/image", when the list says.
  price: string | null;
  unavailable: string | null;
  modelKey: string | null;
}

const span = (values: number[]) =>
  values.length === 0 ? null : values.length === 1 ? `${values[0]} s` : `${values[0]}–${values.at(-1)} s`;

// Every video model the providers offer today, one tab each: search a list
// and add a model to the studio in one click, with the settings it takes.
export function ModelCatalogDialog({
  medium = "video",
  onClose,
  onAdded,
  onAskKey,
}: {
  medium?: ShotMedium;
  onClose: () => void;
  // The model added (or already there), to tick it in the composer.
  onAdded: (modelKey: string) => void;
  onAskKey: (provider: CatalogTab) => void;
}) {
  const utils = api.useUtils();
  const tabs = TABS_FOR[medium];
  const [tab, setTab] = useState<CatalogTab>(tabs[0]!);
  const forVideo = medium === "video";
  const [query, setQuery] = useState("");
  const status = api.settings.credentials.status.useQuery();
  const fal = api.settings.models.falCatalog.useQuery(undefined, {
    staleTime: 10 * 60_000,
    retry: false,
    enabled: forVideo && tab === "fal",
  });
  const video = api.settings.models.videoCatalog.useQuery(undefined, {
    staleTime: 10 * 60_000,
    retry: false,
    enabled: forVideo && tab !== "fal",
  });
  const mediaList = api.settings.models.mediaCatalog.useQuery(
    { medium: medium === "speech" ? "speech" : "image" },
    { staleTime: 10 * 60_000, retry: false, enabled: !forVideo },
  );
  const added = async ({ modelKey }: { modelKey: string }) => {
    await Promise.all([
      utils.shots.models.invalidate(),
      utils.settings.models.list.invalidate(),
      utils.settings.models.falCatalog.invalidate(),
      utils.settings.models.videoCatalog.invalidate(),
      utils.settings.models.mediaCatalog.invalidate(),
      utils.shots.mediaModels.invalidate(),
      utils.studio.modelOptions.invalidate(),
    ]);
    onAdded(modelKey);
  };
  const addFal = api.settings.models.addFal.useMutation({ onSuccess: added });
  const addVideo = api.settings.models.addVideo.useMutation({ onSuccess: added });
  const addMedia = api.settings.models.addMedia.useMutation({ onSuccess: added });
  const list = !forVideo ? mediaList : tab === "fal" ? fal : video;
  const adding = addFal.isPending || addVideo.isPending || addMedia.isPending;
  const addError = addFal.error ?? addVideo.error ?? addMedia.error;

  const rows: CatalogRow[] = !forVideo
    ? (mediaList.data ?? [])
        .filter((m) => m.provider === tab)
        .map((m) => ({
          id: m.id,
          name: m.name,
          owner: m.owner,
          summary: m.summary,
          price: mediaPriceLabel(m.price)?.replace(" est.", "") ?? null,
          unavailable: m.unavailable,
          modelKey: m.modelKey,
        }))
    : tab === "fal"
      ? (fal.data ?? []).map((m) => ({
          id: m.endpoint,
          name: m.label,
          owner: m.owner,
          summary: null,
          price: null,
          unavailable: null,
          modelKey: m.modelKey,
        }))
      : (video.data ?? [])
          .filter((m) => m.provider === tab)
          .map((m) => ({
            id: m.id,
            name: m.name,
            owner: m.owner,
            summary:
              [
                span(m.durations),
                m.aspectRatios.join(" "),
                m.resolutions.join(" "),
                m.audio ? "sound" : m.audio === false ? "silent" : "",
              ]
                .filter(Boolean)
                .join(" · ") || null,
            price: m.pricePerSecondUsd == null ? null : `$${m.pricePerSecondUsd.toFixed(3)}/s`,
            unavailable: m.unavailable,
            modelKey: m.modelKey,
          }));
  const shown = matchModels(
    rows.map((r) => ({ ...r, key: r.id, label: r.name, vendor: r.owner })),
    query,
  ).slice(0, 80);
  const tabName = CATALOG_TABS.find((t) => t.id === tab)!.name;
  const hasKey = status.data?.[tab]?.configured ?? true;

  return (
    <Modal labelledBy="catalog-title" onClose={onClose} className="w-[min(44rem,calc(100vw-2rem))]">
      <div className="flex max-h-[85dvh] flex-col p-6">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h2 id="catalog-title" className="font-display text-xl font-semibold tracking-[-0.01em]">
              {TITLE[medium]}
            </h2>
            <p className="mt-1 text-sm text-pretty text-muted">
              What each provider offers today. An added model renders on that provider's key, with the settings it
              takes.
            </p>
          </div>
          <CloseButton onClose={onClose} />
        </div>
        <div role="tablist" aria-label="Providers" className="mb-3 flex flex-wrap gap-1">
          {CATALOG_TABS.filter((t) => tabs.includes(t.id)).map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={chipClass(tab === t.id, "", "sm")}
            >
              {t.name}
            </button>
          ))}
        </div>
        {hasKey ? null : (
          <div className="mb-3">
            <ProviderWarning>
              They need {KEY_NAME[tab]} key to render.{" "}
              <button
                type="button"
                onClick={() => onAskKey(tab)}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Add your key
              </button>
            </ProviderWarning>
          </div>
        )}
        <label className="relative block">
          <span className="sr-only">Search {tabName}'s models</span>
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              medium === "image"
                ? "Flux, Seedream, GPT Image, Nano Banana…"
                : medium === "speech"
                  ? "Eleven v3, Gemini TTS, Fish Audio…"
                  : "Kling, Seedance, Wan, Veo…"
            }
            className={`${fieldClass} pl-9`}
          />
        </label>
        {list.error ? (
          <div className="mt-3">
            <ErrorNote>{errorText(list.error)}</ErrorNote>
          </div>
        ) : null}
        {addError ? (
          <div className="mt-3">
            <ErrorNote>{errorText(addError)}</ErrorNote>
          </div>
        ) : null}
        <ul aria-label={`${tabName} models`} className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {list.isPending ? (
            <li>
              <SkeletonRows rows={5} />
            </li>
          ) : shown.length === 0 ? (
            <li className="px-1 py-3 text-sm text-muted">
              {rows.length === 0 && tab === "replicate" && !hasKey
                ? "Replicate lists its models to a saved token."
                : rows.length === 0 && tab === "google" && !hasKey
                  ? "Google lists its Veo models to a saved key."
                  : "No model matches."}
            </li>
          ) : (
            shown.map((m) => {
              const busy =
                (addFal.isPending && addFal.variables?.endpoint === m.id) ||
                (addVideo.isPending && addVideo.variables?.id === m.id) ||
                (addMedia.isPending && addMedia.variables?.id === m.id);
              return (
                <li key={m.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.name}</p>
                    <p className="truncate font-mono text-xs text-muted">
                      {m.id}
                      {m.summary ? <span className="font-sans"> · {m.summary}</span> : null}
                    </p>
                    {m.unavailable ? <p className="mt-0.5 text-xs text-warning">{m.unavailable}</p> : null}
                  </div>
                  {m.price ? (
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted">{m.price}</span>
                  ) : null}
                  {m.modelKey ? (
                    <Button size="sm" variant="quiet-primary" onClick={() => onAdded(m.modelKey!)}>
                      <CheckIcon className="size-4" />
                      Use
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={adding || Boolean(m.unavailable)}
                      onClick={() =>
                        !forVideo
                          ? addMedia.mutate({
                              medium: medium === "speech" ? "speech" : "image",
                              provider: tab,
                              id: m.id,
                            })
                          : tab === "fal"
                            ? addFal.mutate({ endpoint: m.id })
                            : addVideo.mutate({ provider: tab as CatalogVideoTab, id: m.id })
                      }
                    >
                      {busy ? "Adding…" : "Add"}
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
          {!shot.videoUrl ? null : shot.medium === "image" ? (
            // biome-ignore lint/performance/noImgElement: a stored render, served by the studio itself
            <img src={shot.videoUrl} alt={shot.prompt.slice(0, 120)} className="max-h-[80dvh] w-full object-contain" />
          ) : shot.medium === "speech" ? (
            <div className="w-full p-6">
              <audio src={shot.videoUrl} controls autoPlay className="w-full" />
            </div>
          ) : (
            <video
              src={shot.videoUrl}
              controls
              autoPlay
              playsInline
              loop
              className="max-h-[80dvh] w-full object-contain"
            />
          )}
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
            {shot.medium === "speech" ? (
              <>
                <dt className="text-muted">Voice</dt>
                <dd>{(shot.options as { voice?: string } | null)?.voice ?? "The model's own"}</dd>
              </>
            ) : (
              <>
                <dt className="text-muted">Format</dt>
                <dd className="font-mono">{shot.aspectRatio}</dd>
              </>
            )}
            {shot.medium !== "image" && (shot.videoDurationS || shot.durationS) ? (
              <>
                <dt className="text-muted">Length</dt>
                <dd className="font-mono">
                  {shot.videoDurationS ? `${shot.videoDurationS.toFixed(1)} s` : `${shot.durationS} s`}
                </dd>
              </>
            ) : null}
            {shot.medium === "speech" ? null : (
              <>
                <dt className="text-muted">{shot.medium === "image" ? "Size" : "Resolution"}</dt>
                <dd className="font-mono">
                  {shot.width && shot.height ? `${shot.width}×${shot.height}` : shot.resolution}
                </dd>
              </>
            )}
            {shot.costUsd != null ? (
              <>
                <dt className="text-muted">Cost</dt>
                <dd className="font-mono">
                  ${Number(shot.costUsd).toFixed(Number(shot.costUsd) < 0.1 ? 3 : 2)}
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
