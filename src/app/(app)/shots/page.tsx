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
import { KeyDialog, ShotViewer } from "./dialogs";
import { Gallery, ScopeTabs, type GalleryScope } from "./gallery";
import {
  EMPTY_MEMORY,
  MAX_MODELS,
  MAX_RENDERS,
  MEMORY_KEY,
  parseMemory,
  selectionKey,
  settingsFor,
  sharedCapabilities,
  type ComposerMemory,
  type ShotSettings,
} from "./shot-settings";
import type { Shot, ShotModel } from "./types";

// How long a deleted shot can be brought back before it is really deleted.
const UNDO_MS = 6000;
// How often the gallery asks again while a shot renders.
const POLL_MS = 4000;

const STARTERS = [
  "A slow dolly toward a steaming cup of coffee on a windowsill at dawn, soft warm light.",
  "Handheld close-up of hands unboxing a pair of white sneakers, studio light, shallow depth of field.",
  "A drone shot rising over a quiet beach at golden hour, gentle waves, no people.",
];

const credentialOf = (model: ShotModel | null): ProviderAccountId | null =>
  model?.credential === "google" || model?.credential === "fal" ? model.credential : null;

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
        lede="Describe a shot and render it on one model or several side by side, without a project or a script. Try another model or setting, keep the ones you like."
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
  const [scope, setScope] = useState<GalleryScope>("all");
  const [viewing, setViewing] = useState<Shot | null>(null);
  const [askKey, setAskKey] = useState<ShotModel | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Shots hidden now and deleted when the undo bar runs out.
  const [pending, setPending] = useState<{ ids: string[]; timer: number } | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const models = api.shots.models.useQuery({ workspaceId });
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
            title="Your first shot"
            body="Describe what the camera sees, pick a model and launch. Each render lands here, ready to compare, reuse or download."
          >
            <ul className="mx-auto mt-6 flex max-w-xl flex-col gap-2 text-left">
              {STARTERS.map((starter) => (
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
        {models.isPending ? (
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
      {askKey && credentialOf(askKey) ? (
        <KeyDialog provider={credentialOf(askKey)!} modelLabel={askKey.label} onClose={() => setAskKey(null)} />
      ) : null}
    </div>
  );
}
