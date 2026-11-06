"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { errorText } from "~/app/_components/errors";
import { NeedsSelfHosted, useEdition } from "~/app/_components/edition";
import { usePageTitle } from "~/app/_components/page-title";
import { Button, EmptyState, ErrorNote, PageHeader, SignedOutNotice, Skeleton } from "~/app/_components/ui";
import { useWorkspace } from "~/app/_components/workspace-context";
import { api } from "~/trpc/react";
import type { ProviderAccountId } from "../settings/provider-accounts";
import { Composer } from "./composer";
import { MediaComposer } from "./media-composer";
import { CATALOG_TABS, KeyDialog, KeysDialog, ModelCatalogDialog, ShotViewer, type CatalogTab } from "./dialogs";
import { Gallery, ScopeTabs, type GalleryScope } from "./gallery";
import {
  EMPTY_MEDIA_MEMORY,
  EMPTY_MEMORY,
  MAX_MODELS,
  MEDIA_MEMORY_KEY,
  mediaPriceLabel,
  parseMediaMemory,
  sharedRatios,
  type MediaMemory,
  type ShotMedium,
  MAX_RENDERS,
  MEMORY_KEY,
  parseMemory,
  selectionKey,
  settingsFor,
  sharedCapabilities,
  type ComposerMemory,
  type ShotSettings,
} from "./shot-settings";
import type { MediaShotModel, Shot, ShotModel } from "./types";

// How long a deleted shot can be brought back before it is really deleted.
const UNDO_MS = 6000;
// How often the gallery asks again while a shot renders.
const POLL_MS = 4000;

const STARTERS: Record<ShotMedium, string[]> = {
  video: [
    "A slow dolly toward a steaming cup of coffee on a windowsill at dawn, soft warm light.",
    "Handheld close-up of hands unboxing a pair of white sneakers, studio light, shallow depth of field.",
    "A drone shot rising over a quiet beach at golden hour, gentle waves, no people.",
  ],
  image: [
    "A ceramic mug of black coffee on a linen tablecloth, morning window light, 50 mm, shallow depth of field.",
    "A pair of white sneakers on a pastel blue backdrop, soft studio light, product photo.",
    "A quiet beach at golden hour seen from the dunes, long shadows, film grain.",
  ],
  speech: [
    "Hi! I tried this for a week, and honestly, it changed my mornings.",
    "Three things nobody tells you before you start running. Number one: the shoes matter less than you think.",
    "Link in my bio if you want to try it yourself. See you tomorrow!",
  ],
};

const MEDIA_TABS: { id: ShotMedium; label: string }[] = [
  { id: "video", label: "Video" },
  { id: "image", label: "Photo" },
  { id: "speech", label: "Voice" },
];

function useMediaMemory(): [MediaMemory, (patch: Partial<MediaMemory>) => void] {
  const [memory, setMemory] = useState<MediaMemory>(EMPTY_MEDIA_MEMORY);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setMemory(parseMediaMemory(window.localStorage.getItem(MEDIA_MEMORY_KEY)));
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(MEDIA_MEMORY_KEY, JSON.stringify(memory));
    } catch {
      // A full or blocked storage only loses the draft.
    }
  }, [memory, loaded]);
  const update = useCallback((patch: Partial<MediaMemory>) => setMemory((m) => ({ ...m, ...patch })), []);
  return [memory, update];
}

// The account whose key a cloud model renders on.
const credentialOf = (model: ShotModel | null): ProviderAccountId | null => model?.credential ?? null;

function useComposerMemory(): [ComposerMemory, (patch: Partial<ComposerMemory>) => void] {
  const [memory, setMemory] = useState<ComposerMemory>(EMPTY_MEMORY);
  // State, not a ref: only a render after the read may write, so the empty
  // first draft never overwrites the saved one (effects can run twice).
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setMemory(parseMemory(window.localStorage.getItem(MEMORY_KEY)));
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
    } catch {
      // A full or blocked storage only loses the draft.
    }
  }, [memory, loaded]);
  const update = useCallback((patch: Partial<ComposerMemory>) => setMemory((m) => ({ ...m, ...patch })), []);
  return [memory, update];
}

export default function ShotsPage() {
  usePageTitle("Shots");
  const workspace = useWorkspace();
  const edition = useEdition();

  if (workspace.status === "unauthenticated") return <SignedOutNotice />;
  return (
    <>
      <PageHeader
        title="Shots"
        lede="Describe a shot, a photo or a line to say, and render it on one model or several side by side, without a project or a script. Try another model or setting, keep the ones you like."
      />
      {edition.kind === "browser" ? (
        <NeedsSelfHosted>
          Shots render on cloud models with your own API keys, which only the self-hosted studio can keep. The renderer
          in this browser voices a script: use it from a project.
        </NeedsSelfHosted>
      ) : workspace.status === "ready" ? (
        <ShotsStudio workspaceId={workspace.workspaceId} />
      ) : (
        <Skeleton className="h-40 w-full" />
      )}
    </>
  );
}

function ShotsStudio({ workspaceId }: { workspaceId: string }) {
  const utils = api.useUtils();
  const [memory, remember] = useComposerMemory();
  const [media, rememberMedia] = useMediaMemory();
  const medium = media.medium;
  const [scope, setScope] = useState<GalleryScope>("all");
  const [viewing, setViewing] = useState<Shot | null>(null);
  const [askKey, setAskKey] = useState<ShotModel | null>(null);
  const [askMediaKey, setAskMediaKey] = useState<MediaShotModel | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  const [falOpen, setFalOpen] = useState(false);
  // A catalog tab's provider, whose key the catalog asked for.
  const [askProvider, setAskProvider] = useState<CatalogTab | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Shots hidden now and deleted when the undo bar runs out.
  const [pending, setPending] = useState<{ ids: string[]; timer: number } | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const models = api.shots.models.useQuery({ workspaceId });
  const mediaModels = api.shots.mediaModels.useQuery({ workspaceId });
  const actors = api.actors.list.useQuery(undefined, { staleTime: 5 * 60_000 });
  const list = api.shots.list.useQuery(
    { workspaceId, favorites: scope === "favorites" },
    {
      refetchInterval: (query) =>
        query.state.data?.some((s) => s.status === "queued" || s.status === "in_progress") ? POLL_MS : false,
    },
  );

  const all = models.data?.models ?? [];
  const offered = all.filter((m) => !m.needsScript);
  // The models ticked, in the order they were picked; the studio default
  // (or the first that can launch) until the visitor picks.
  const remembered = memory.modelKeys
    .map((key) => offered.find((m) => m.key === key))
    .filter((m): m is ShotModel => Boolean(m));
  const fallback =
    offered.find((m) => m.key === models.data?.defaultModelKey) ?? offered.find((m) => m.available) ?? offered[0];
  const chosen = remembered.length ? remembered : fallback ? [fallback] : [];
  const shared = sharedCapabilities(chosen);
  const selection = selectionKey(chosen.map((m) => m.key));
  const settings =
    shared && !shared.missing ? settingsFor(shared.capabilities, chosen[0]!.defaults, memory.byModel[selection]) : null;
  // The launch stays within MAX_RENDERS renders in all.
  const count = Math.max(1, Math.min(memory.count, Math.floor(MAX_RENDERS / Math.max(chosen.length, 1))));

  // The photo and voice models, as the picker shows them.
  const mediaOf = (kind: "image" | "speech"): MediaShotModel[] =>
    (mediaModels.data ?? [])
      .filter((m) => m.medium === kind)
      .map((m) => ({ ...m, priceLabel: mediaPriceLabel(m.price), unavailableReason: m.statusDetail }));
  const photoModels = mediaOf("image");
  const voiceModels = mediaOf("speech");
  const pickedPhotos = media.photoKeys
    .map((key) => photoModels.find((m) => m.key === key))
    .filter((m): m is MediaShotModel => Boolean(m));
  const chosenPhotos = pickedPhotos.length
    ? pickedPhotos
    : photoModels.find((m) => m.available)
      ? [photoModels.find((m) => m.available)!]
      : photoModels.slice(0, 1);
  const photoRatios = sharedRatios(chosenPhotos);
  const photoRatio =
    media.aspectRatio && photoRatios.includes(media.aspectRatio) ? media.aspectRatio : (photoRatios[0] ?? null);
  const chosenVoice =
    voiceModels.find((m) => m.key === media.voiceKey) ?? voiceModels.find((m) => m.available) ?? voiceModels[0];
  const voice = chosenVoice ? (media.voices[chosenVoice.key] ?? null) : null;
  const photoCount = Math.max(1, Math.min(memory.count, Math.floor(MAX_RENDERS / Math.max(chosenPhotos.length, 1))));
  const mediaCost =
    medium === "image"
      ? chosenPhotos.length && chosenPhotos.every((m) => m.price)
        ? chosenPhotos.reduce((sum, m) => sum + (m.price?.usd ?? 0) * photoCount, 0)
        : null
      : chosenVoice?.price
        ? (chosenVoice.price.usd * memory.text.length) / 1_000_000
        : null;

  const refresh = () => Promise.all([utils.shots.list.invalidate()]);

  const launch = api.shots.launch.useMutation({
    onSuccess: async (launched) => {
      const refused = launched.find((l) => l.status === "failed");
      setError(refused ? (refused.errorDetail ?? "The model did not accept the shot.") : null);
      setScope("all");
      await refresh();
    },
    onError: (e) => setError(errorText(e)),
  });
  const afterMedia = {
    onSuccess: async (launched: { status: string; errorDetail: string | null }[]) => {
      const refused = launched.find((l) => l.status === "failed");
      setError(refused ? (refused.errorDetail ?? "The model did not render it.") : null);
      setScope("all");
      await refresh();
    },
    onError: (e: unknown) => setError(errorText(e as Error)),
  };
  const launchPhoto = api.shots.launchPhoto.useMutation(afterMedia);
  const launchVoice = api.shots.launchVoice.useMutation(afterMedia);

  const toggleMedia = (model: MediaShotModel) => {
    if (model.medium === "speech") {
      rememberMedia({ voiceKey: model.key });
    } else {
      const keys = chosenPhotos.map((m) => m.key);
      if (keys.includes(model.key)) {
        if (keys.length > 1) rememberMedia({ photoKeys: keys.filter((k) => k !== model.key) });
        return;
      }
      if (keys.length >= MAX_MODELS) return;
      rememberMedia({ photoKeys: [...keys, model.key] });
    }
    if (model.status === "missing-credentials") setAskMediaKey(model);
  };

  const onLaunchMedia = () => {
    const pending = medium === "image" ? chosenPhotos : chosenVoice ? [chosenVoice] : [];
    const keyless = pending.find((m) => m.status === "missing-credentials");
    if (keyless) {
      setAskMediaKey(keyless);
      return;
    }
    setError(null);
    if (medium === "image" && photoRatio)
      launchPhoto.mutate({
        workspaceId,
        text: memory.text,
        modelKeys: chosenPhotos.map((m) => m.key),
        aspectRatio: photoRatio,
        count: photoCount,
        actorId: memory.actorId,
      });
    else if (medium === "speech" && chosenVoice)
      launchVoice.mutate({
        workspaceId,
        text: memory.text,
        modelKey: chosenVoice.key,
        voice,
        instructions: media.instructions || null,
        actorId: memory.actorId,
      });
  };

  const relaunch = api.shots.relaunch.useMutation({ onSettled: refresh, onError: (e) => setError(errorText(e)) });
  const favorite = api.shots.favorite.useMutation({ onSettled: refresh, onError: (e) => setError(errorText(e)) });

  const commitDelete = (ids: string[]) => {
    void utils.client.shots.delete
      .mutate({ workspaceId, generationIds: ids })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "The shot could not be deleted."))
      .finally(() => void utils.shots.list.invalidate());
  };
  // The newest commitDelete, for the unmount below: an effect depending on
  // it would run its cleanup, and delete, on every render.
  const commitRef = useRef(commitDelete);
  commitRef.current = commitDelete;

  // Leaving the page does not cancel a deletion already decided.
  useEffect(
    () => () => {
      const p = pendingRef.current;
      if (p) {
        window.clearTimeout(p.timer);
        commitRef.current(p.ids);
      }
    },
    [],
  );

  const remove = (shot: Shot) => {
    const previous = pendingRef.current;
    if (previous) {
      window.clearTimeout(previous.timer);
      commitDelete(previous.ids);
    }
    const ids = [shot.id];
    const timer = window.setTimeout(() => {
      setPending(null);
      commitDelete(ids);
    }, UNDO_MS);
    setPending({ ids, timer });
  };

  const undo = () => {
    if (!pending) return;
    window.clearTimeout(pending.timer);
    setPending(null);
  };

  // Tick a model on or off; the last one stays. One that needs its key asks
  // for it.
  const toggleModel = (model: ShotModel) => {
    const keys = chosen.map((m) => m.key);
    if (keys.includes(model.key)) {
      if (keys.length > 1) remember({ modelKeys: keys.filter((k) => k !== model.key) });
      return;
    }
    if (keys.length >= MAX_MODELS) return;
    remember({ modelKeys: [...keys, model.key] });
    if (model.status === "missing-credentials" && credentialOf(model)) setAskKey(model);
  };

  const patchSettings = (patch: Partial<ShotSettings>) => {
    if (!settings) return;
    remember({ byModel: { ...memory.byModel, [selection]: { ...settings, ...patch } } });
  };

  const onLaunch = () => {
    if (!settings || chosen.length === 0) return;
    const keyless = chosen.find((m) => m.status === "missing-credentials" && credentialOf(m));
    if (keyless) {
      setAskKey(keyless);
      return;
    }
    setError(null);
    launch.mutate({
      workspaceId,
      text: memory.text,
      modelKeys: chosen.map((m) => m.key),
      ...settings,
      actorId: memory.actorId,
      count,
    });
  };

  const reuse = (shot: Shot) => {
    if (shot.medium !== "video") {
      const options = (shot.options ?? {}) as { voice?: string };
      remember({ text: shot.prompt, actorId: null });
      rememberMedia(
        shot.medium === "image"
          ? { medium: "image", photoKeys: [shot.modelKey], aspectRatio: shot.aspectRatio || null }
          : {
              medium: "speech",
              voiceKey: shot.modelKey,
              voices: options.voice ? { ...media.voices, [shot.modelKey]: options.voice } : media.voices,
            },
      );
      setViewing(null);
      setFocusNonce((n) => n + 1);
      return;
    }
    rememberMedia({ medium: "video" });
    const target = offered.find((m) => m.key === shot.modelKey);
    remember({
      text: shot.prompt,
      // The stored text already describes the actor it was made with.
      actorId: null,
      ...(target
        ? {
            modelKeys: [target.key],
            byModel: {
              ...memory.byModel,
              [selectionKey([target.key])]: {
                aspectRatio: shot.aspectRatio,
                durationS: shot.durationS,
                resolution: shot.resolution,
              },
            },
          }
        : {}),
    });
    setViewing(null);
    setFocusNonce((n) => n + 1);
  };

  const shots = useMemo(() => (list.data ?? []).filter((s) => !pending?.ids.includes(s.id)), [list.data, pending]);
  const loadError = models.error ?? list.error;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ScopeTabs scope={scope} onScope={setScope} />
        <Button size="sm" variant="secondary" onClick={() => setKeysOpen(true)} className="ml-auto">
          API keys
        </Button>
        {pending ? (
          <div
            role="status"
            className="relative flex items-center gap-3 overflow-hidden rounded-full bg-raised py-1 pr-1 pl-4 text-sm shadow-card"
          >
            Shot deleted.
            <Button size="sm" variant="quiet-primary" onClick={undo}>
              Undo
            </Button>
            <span
              aria-hidden
              className="undo-drain absolute inset-x-0 bottom-0 h-px origin-left bg-primary"
              style={{ animationDuration: `${UNDO_MS}ms` }}
            />
          </div>
        ) : null}
      </div>

      {loadError ? <ErrorNote>{errorText(loadError)}</ErrorNote> : null}

      {list.isPending ? (
        <div className="grid gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="aspect-[9/16] w-full" />
          <Skeleton className="aspect-video w-full" />
          <Skeleton className="aspect-[9/16] w-full max-lg:hidden" />
        </div>
      ) : shots.length === 0 ? (
        scope === "favorites" ? (
          <EmptyState
            title="No favorites yet"
            body="Mark the shots worth keeping with the star under them, and they wait for you here."
          />
        ) : (
          <EmptyState
            title={
              medium === "image"
                ? "Your first photo"
                : medium === "speech"
                  ? "Your first voice clip"
                  : "Your first shot"
            }
            body={
              medium === "image"
                ? "Describe the photo, pick one model or several and launch. Each photo lands here, ready to compare, reuse or download."
                : medium === "speech"
                  ? "Write the line, pick a voice and launch. Each clip lands here, ready to play, reuse or download."
                  : "Describe what the camera sees, pick a model and launch. Each render lands here, ready to compare, reuse or download."
            }
          >
            <ul className="mx-auto mt-6 flex max-w-xl flex-col gap-2 text-left">
              {STARTERS[medium].map((starter) => (
                <li key={starter}>
                  <button
                    type="button"
                    onClick={() => {
                      remember({ text: starter });
                      setFocusNonce((n) => n + 1);
                    }}
                    className="w-full rounded-xl px-4 py-3 text-sm text-pretty shadow-[inset_0_0_0_1px_var(--troupe-color-line)] transition-colors duration-150 hover:bg-fg/[0.04]"
                  >
                    {starter}
                  </button>
                </li>
              ))}
            </ul>
          </EmptyState>
        )
      ) : (
        <Gallery
          shots={shots}
          onOpen={setViewing}
          onReuse={reuse}
          onFavorite={(shot) => favorite.mutate({ workspaceId, generationId: shot.id, on: !shot.favorite })}
          onDelete={remove}
          onRelaunch={(shot) => relaunch.mutate({ workspaceId, generationId: shot.id })}
          relaunching={relaunch.isPending ? (relaunch.variables?.generationId ?? null) : null}
        />
      )}

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 sm:bottom-6">
        <div
          role="tablist"
          aria-label="What to render"
          className="mb-2 inline-flex items-center gap-0.5 rounded-full bg-raised p-1 shadow-card"
        >
          {MEDIA_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={medium === tab.id}
              onClick={() => {
                rememberMedia({ medium: tab.id });
                setError(null);
              }}
              className={`min-h-8 rounded-full px-3.5 text-sm font-medium transition-colors duration-150 ${
                medium === tab.id ? "bg-primary text-on-primary" : "text-muted hover:bg-fg/[0.06] hover:text-fg"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {medium !== "video" ? (
          mediaModels.isPending ? (
            <Skeleton className="h-32 w-full rounded-2xl" />
          ) : (
            <>
              {(medium === "image" ? photoModels : voiceModels).length === 0 ? (
                <div className="mb-3 rounded-2xl bg-raised p-4 text-sm shadow-card">
                  {medium === "image" ? "No photo model yet." : "No voice model yet."}{" "}
                  <button
                    type="button"
                    onClick={() => setFalOpen(true)}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Add one from the providers' lists
                  </button>
                </div>
              ) : null}
              <MediaComposer
                medium={medium}
                text={memory.text}
                onText={(text) => remember({ text })}
                models={medium === "image" ? photoModels : voiceModels}
                chosen={medium === "image" ? chosenPhotos : chosenVoice ? [chosenVoice] : []}
                onToggleModel={toggleMedia}
                onBrowseModels={() => setFalOpen(true)}
                aspectRatios={photoRatios}
                aspectRatio={photoRatio}
                onAspectRatio={(aspectRatio) => rememberMedia({ aspectRatio })}
                voice={voice}
                onVoice={(v) => {
                  if (!chosenVoice) return;
                  const voices = { ...media.voices };
                  if (v) voices[chosenVoice.key] = v;
                  else delete voices[chosenVoice.key];
                  rememberMedia({ voices });
                }}
                instructions={media.instructions}
                onInstructions={(instructions) => rememberMedia({ instructions })}
                actors={(actors.data ?? []).map((a) => ({ id: a.id, name: a.name }))}
                actorId={memory.actorId}
                onActor={(actorId) => remember({ actorId })}
                count={photoCount}
                onCount={(count) => remember({ count })}
                cost={mediaCost}
                launching={launchPhoto.isPending || launchVoice.isPending}
                error={error}
                onLaunch={onLaunchMedia}
                focusNonce={focusNonce}
              />
            </>
          )
        ) : models.isPending ? (
          <Skeleton className="h-32 w-full rounded-2xl" />
        ) : offered.length === 0 ? (
          <ErrorNote>No model can render a shot yet. Add a cloud key or a local model in Settings.</ErrorNote>
        ) : (
          <Composer
            text={memory.text}
            onText={(text) => remember({ text })}
            models={all}
            chosen={chosen}
            onToggleModel={toggleModel}
            onBrowseModels={() => setFalOpen(true)}
            capabilities={shared?.capabilities ?? null}
            missing={shared?.missing ?? null}
            soundPerModel={shared?.soundPerModel ?? false}
            settings={settings}
            onSettings={patchSettings}
            actors={(actors.data ?? []).map((a) => ({ id: a.id, name: a.name }))}
            actorId={memory.actorId}
            onActor={(actorId) => remember({ actorId })}
            count={count}
            onCount={(count) => remember({ count })}
            launching={launch.isPending}
            error={error}
            onLaunch={onLaunch}
            focusNonce={focusNonce}
          />
        )}
      </div>

      {viewing ? (
        <ShotViewer
          shot={shots.find((s) => s.id === viewing.id) ?? viewing}
          onClose={() => setViewing(null)}
          onReuse={() => reuse(viewing)}
          onFavorite={() => favorite.mutate({ workspaceId, generationId: viewing.id, on: !viewing.favorite })}
        />
      ) : null}
      {keysOpen ? <KeysDialog onClose={() => setKeysOpen(false)} /> : null}
      {falOpen ? (
        <ModelCatalogDialog
          medium={medium}
          onClose={() => setFalOpen(false)}
          onAskKey={(provider) => {
            setFalOpen(false);
            setAskProvider(provider);
          }}
          onAdded={(modelKey) => {
            if (medium === "image") {
              const keys = chosenPhotos.map((m) => m.key);
              if (!keys.includes(modelKey))
                rememberMedia({
                  photoKeys: keys.length >= MAX_MODELS ? [...keys.slice(1), modelKey] : [...keys, modelKey],
                });
              setFalOpen(false);
              return;
            }
            if (medium === "speech") {
              rememberMedia({ voiceKey: modelKey });
              setFalOpen(false);
              return;
            }
            const keys = chosen.map((m) => m.key);
            if (!keys.includes(modelKey))
              remember({ modelKeys: keys.length >= MAX_MODELS ? [...keys.slice(1), modelKey] : [...keys, modelKey] });
            setFalOpen(false);
          }}
        />
      ) : null}
      {askMediaKey ? (
        <KeyDialog
          provider={askMediaKey.credential as ProviderAccountId}
          modelLabel={askMediaKey.label}
          onClose={() => setAskMediaKey(null)}
        />
      ) : null}
      {askKey && credentialOf(askKey) ? (
        <KeyDialog provider={credentialOf(askKey)!} modelLabel={askKey.label} onClose={() => setAskKey(null)} />
      ) : null}
      {askProvider ? (
        <KeyDialog
          provider={askProvider}
          modelLabel={`${CATALOG_TABS.find((t) => t.id === askProvider)?.name ?? askProvider}'s models`}
          onClose={() => {
            setAskProvider(null);
            setFalOpen(true);
          }}
        />
      ) : null}
    </div>
  );
}
