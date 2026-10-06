"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { use, useCallback, useRef, useState } from "react";

import { useEdition } from "~/app/_components/edition";
import { errorText, isUuid } from "~/app/_components/errors";
import { usePageTitle } from "~/app/_components/page-title";
import { useMediaQuery } from "~/app/_components/use-media-query";
import { useWorkspace } from "~/app/_components/workspace-context";
import { ArrowLeftIcon, ExternalIcon } from "~/app/_components/icons";
import {
  Button,
  EmptyState,
  ErrorNote,
  ProgressBar,
  ProviderWarning,
  Section,
  SignedOutNotice,
  SkeletonRows,
  buttonClass,
  chipClass,
} from "~/app/_components/ui";
import { api } from "~/trpc/react";
import { clock, KIND_LABELS } from "../format";
import { IdeaCards } from "../idea-cards";
import { LibraryChat } from "../library-chat";
import { ItemStatusChip } from "../library-table";
import { ItemAnalysis } from "./item-analysis";
import { ItemTimeline } from "./item-timeline";
import { MakeIdeas } from "./make-ideas";

// One saved item: the player, its timeline (hook, structure, pictures),
// what the analysis found, the transcript, ideas from it and a chat about it.
export default function LibraryItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = use(params);
  const workspace = useWorkspace();
  const edition = useEdition();
  const router = useRouter();
  const wide = useMediaQuery("(min-width: 1024px)");
  const startAt = Number(useSearchParams().get("t"));
  const ready = workspace.status === "ready";
  const validId = isUuid(itemId);
  const workspaceId = workspace.workspaceId ?? "";
  const utils = api.useUtils();
  const item = api.library.get.useQuery(
    { workspaceId, itemId },
    {
      enabled: ready && validId,
      retry: false,
      refetchInterval: (q) =>
        q.state.data && (q.state.data.status === "queued" || q.state.data.status === "analyzing") ? 2000 : false,
    },
  );
  usePageTitle(item.data?.title, "Library");
  const refresh = () =>
    Promise.all([utils.library.get.invalidate({ workspaceId, itemId }), utils.library.list.invalidate()]);
  const update = api.library.update.useMutation({ onSuccess: refresh });
  const reanalyze = api.library.reanalyze.useMutation({ onSuccess: refresh });
  const remove = api.library.delete.useMutation({
    onSuccess: async () => {
      await utils.library.list.invalidate();
      router.push("/library");
    },
  });
  const [confirming, setConfirming] = useState(false);

  const player = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [currentS, setCurrentS] = useState(0);
  const seek = useCallback((seconds: number) => {
    const media = player.current;
    setCurrentS(seconds);
    if (!media) return;
    media.currentTime = seconds;
    media.focus({ preventScroll: true });
  }, []);
  // A link with ?t= (a search result, a citation) opens at that moment.
  const seeked = useRef(false);
  const [loadedShape, setLoadedShape] = useState(false);
  const onLoaded = () => {
    setLoadedShape(true);
    if (!seeked.current && startAt > 0) seek(startAt);
    seeked.current = true;
  };

  if (workspace.status === "unauthenticated") return <SignedOutNotice />;
  if (workspace.status === "loading" || (ready && validId && item.isPending)) return <SkeletonRows rows={5} />;
  if (workspace.status === "error") return <ErrorNote>{workspace.message}</ErrorNote>;
  if (item.error || !item.data) {
    return (
      <EmptyState
        title="Not in your library"
        body={item.error && validId ? errorText(item.error) : "This item may have been deleted."}
        cta={{ label: "Back to the library", href: "/library" }}
      />
    );
  }

  const it = item.data;
  const analysis = it.analysis;
  const busy = it.status === "queued" || it.status === "analyzing";
  const timed = (it.kind === "video" || it.kind === "audio") && it.durationS && analysis;
  const segments = analysis?.transcript?.segments ?? [];
  const current = segments.findIndex((s) => currentS >= s.startS && currentS < s.endS);
  const host = it.sourceUrl
    ? (() => {
        try {
          return new URL(it.sourceUrl).hostname.replace(/^www\./, "");
        } catch {
          return it.sourceUrl;
        }
      })()
    : null;
  const chat = <LibraryChat workspaceId={workspaceId} itemId={itemId} onSeek={timed ? seek : undefined} />;

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 text-sm">
        <Link
          href="/library"
          className="-ml-1 inline-flex min-h-10 items-center gap-1.5 rounded-md px-1 font-medium text-muted transition-colors duration-150 hover:text-fg"
        >
          <ArrowLeftIcon className="size-4" />
          Library
        </Link>
      </nav>
      <header className="mb-8 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="min-w-0 font-display text-[1.75rem] leading-[1.1] font-semibold tracking-[-0.02em] text-balance break-words sm:text-[2rem]">
            {it.title}
          </h1>
          <ItemStatusChip status={it.status} stage={it.stage} />
        </div>
        <p className="font-mono text-xs tabular-nums text-muted">
          {KIND_LABELS[it.kind]}
          {it.durationS ? ` · ${clock(it.durationS)}` : ""}
          {` · saved ${new Date(it.createdAt).toLocaleDateString()}`}
          {host ? " · " : ""}
          {host && it.sourceUrl ? (
            <a
              href={it.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-0.5 text-primary underline-offset-4 hover:underline"
            >
              {host}
              <ExternalIcon className="size-3.5" />
            </a>
          ) : null}
          {it.fileName ? ` · ${it.fileName}` : ""}
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <label className={chipClass(it.mine)}>
            <input
              type="checkbox"
              checked={it.mine}
              disabled={update.isPending}
              onChange={(e) => update.mutate({ workspaceId, itemId, mine: e.target.checked })}
              className="size-4 accent-[var(--troupe-color-primary)]"
            />
            My own content
          </label>
          <Button
            size="sm"
            disabled={busy || reanalyze.isPending}
            onClick={() => reanalyze.mutate({ workspaceId, itemId })}
          >
            Read it again
          </Button>
          {it.downloadUrl ? (
            <a href={it.downloadUrl} className={buttonClass({ size: "sm" })}>
              Download the original
            </a>
          ) : null}
          {confirming ? (
            <span className="flex items-center gap-1 text-sm">
              <Button
                variant="danger-solid"
                size="sm"
                onClick={() => remove.mutate({ workspaceId, itemId })}
                disabled={remove.isPending}
              >
                {remove.isPending ? "Deleting…" : "Delete it and its files"}
              </Button>
              <Button variant="quiet" size="sm" onClick={() => setConfirming(false)}>
                Keep
              </Button>
            </span>
          ) : (
            <Button variant="quiet-danger" size="sm" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          )}
        </div>
        {it.mine ? (
          <p className="text-xs text-muted">
            Marked as yours: its hooks, tone and pace shape what the library and the script chat write “in your voice”.
          </p>
        ) : null}
      </header>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)] lg:items-start lg:gap-10">
        <div className="min-w-0 space-y-10">
          {busy ? (
            <div role="status" className="space-y-2">
              <ProgressBar
                label={it.status === "queued" ? "Waiting its turn" : (it.stage ?? "Reading")}
                fraction={null}
              />
              <p className="text-xs text-muted">
                The analysis runs on your own models; a long video can take a few minutes.
              </p>
            </div>
          ) : null}
          {it.status === "failed" ? <ErrorNote>It could not be read: {it.problem}</ErrorNote> : null}
          {it.status === "ready" && it.problem ? <ProviderWarning>Read in part. {it.problem}</ProviderWarning> : null}

          <section aria-label="The original" className="space-y-4">
            {it.kind === "video" && it.mediaUrl ? (
              <video
                ref={player}
                src={it.mediaUrl}
                aria-label={it.title}
                controls
                playsInline
                preload="metadata"
                onLoadedMetadata={onLoaded}
                onTimeUpdate={(e) => setCurrentS(e.currentTarget.currentTime)}
                // 16:9 until the video says its own shape.
                className={`max-h-[60vh] w-full rounded-2xl bg-black object-contain shadow-card ${loadedShape ? "" : "aspect-video"}`}
              />
            ) : null}
            {it.kind === "audio" && it.mediaUrl ? (
              <audio
                ref={player}
                src={it.mediaUrl}
                aria-label={it.title}
                controls
                preload="metadata"
                onLoadedMetadata={onLoaded}
                onTimeUpdate={(e) => setCurrentS(e.currentTarget.currentTime)}
                className="w-full"
              />
            ) : null}
            {it.kind === "image" && it.mediaUrl ? (
              // biome-ignore lint/performance/noImgElement: the browser edition has no next/image; these are pictures the studio already sized.
              <img
                src={it.mediaUrl}
                alt={analysis?.frames?.[0]?.description ?? it.title}
                className="max-h-[60vh] rounded-xl object-contain outline outline-1 -outline-offset-1 outline-[var(--picture-edge)]"
              />
            ) : null}
            {it.kind === "pdf" && it.downloadUrl ? (
              <p className="text-sm text-muted">A PDF{it.fileName ? ` (${it.fileName})` : ""}; its text is below.</p>
            ) : null}
            {timed && it.durationS ? (
              <ItemTimeline
                durationS={it.durationS}
                structure={analysis.structure ?? []}
                hookEndS={analysis.hook?.endS}
                frames={analysis.frames ?? []}
                currentS={currentS}
                onSeek={seek}
              />
            ) : null}
          </section>

          {analysis && it.status === "ready" ? (
            <ItemAnalysis analysis={analysis} tags={it.tags} onSeek={timed ? seek : undefined} />
          ) : null}

          {segments.length > 0 ? (
            <Section title="Transcript" className="mb-0">
              <ol className="max-h-96 space-y-0.5 overflow-y-auto overscroll-contain rounded-2xl bg-surface/60 p-2 text-sm">
                {segments.map((s, i) => (
                  <li
                    key={`${s.startS}-${i}`}
                    aria-current={i === current ? "true" : undefined}
                    className={`grid grid-cols-[3.25rem_minmax(0,1fr)] gap-2 rounded-lg px-2 py-1 transition-colors duration-150 ${i === current ? "bg-primary/10" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => seek(s.startS)}
                      aria-label={`Play from ${clock(s.startS)}`}
                      className="self-start rounded text-left font-mono text-xs leading-5 tabular-nums text-primary underline-offset-4 hover:underline"
                    >
                      {clock(s.startS)}
                    </button>
                    <span className="text-pretty">{s.text}</span>
                  </li>
                ))}
              </ol>
            </Section>
          ) : null}

          {it.body && (it.kind === "text" || it.kind === "article" || it.kind === "pdf") ? (
            <Section
              title={it.kind === "article" ? "The article" : it.kind === "pdf" ? "The text" : "The note"}
              className="mb-0"
            >
              <div className="max-h-[28rem] overflow-y-auto overscroll-contain rounded-2xl bg-surface/60 px-5 py-4">
                <p className="max-w-[72ch] whitespace-pre-wrap text-pretty text-sm leading-relaxed">{it.body}</p>
              </div>
            </Section>
          ) : null}

          <Section title="Make something from it" className="mb-0">
            <div className="space-y-6">
              <MakeIdeas
                workspaceId={workspaceId}
                itemId={itemId}
                ready={it.status === "ready"}
                browser={edition.kind === "browser"}
              />
              <IdeaCards
                workspaceId={workspaceId}
                itemId={itemId}
                empty="Ideas written from this item appear here, each ready to become a project."
              />
            </div>
          </Section>

          {!wide ? <section className="border-t border-line pt-6">{chat}</section> : null}
        </div>
        {wide ? (
          <aside
            aria-label="Ask about this item"
            className="sticky top-24 h-[calc(100dvh-8rem)] max-h-[48rem] min-h-[28rem] border-l border-line pl-6"
          >
            {chat}
          </aside>
        ) : null}
      </div>
    </>
  );
}
