"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useEdition } from "~/app/_components/edition";
import { ErrorNote, ProviderWarning, Skeleton } from "~/app/_components/ui";
import { api } from "~/trpc/react";
import { chatClipSeconds, relaunchPlan, type ChatLaunchBase } from "./chat-launch";
import { ProposalCard } from "./chat-proposal";
import { estimateSeconds } from "./script/estimate";

type Line = { role: "hook" | "body" | "cta"; text: string; emotion: "neutral" | "excited" | "calm" | "serious" | "happy" | "disappointed" };
export interface ScriptVersion {
  id: string;
  version: number;
  estimatedDurationS: number;
  lines: Line[];
}

const SUGGESTIONS = ["Make the hook punchier", "Cut it to fit the clip", "Warmer, calmer delivery"];
const FIRST_SUGGESTIONS = ["Write a 3-line script for this project"];

// The project's iteration chat. On wide screens it sits beside the timeline;
// below that it is a sheet that slides up over the page.
export function ChatPanel({
  projectId,
  versions,
  base,
  currentActorId,
  open,
  onClose,
}: {
  projectId: string;
  versions: ScriptVersion[];
  base: ChatLaunchBase | null;
  currentActorId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const edition = useEdition();
  const demoChat = edition.kind === "demo" ? edition.chat : undefined;
  const utils = api.useUtils();
  const history = api.chat.history.useQuery({ projectId }, { retry: false });
  const messages = history.data?.messages ?? [];
  const recasts = messages.some((m) => m.proposal?.actorId);
  const actors = api.actors.list.useQuery(undefined, { enabled: recasts, staleTime: 5 * 60_000 });
  const actorName = (id: string | null | undefined) => (id ? (actors.data?.find((a) => a.id === id)?.name ?? "another actor") : "no actor");

  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const latest = versions.at(-1) ?? null;
  const clipS = chatClipSeconds(base, latest?.estimatedDurationS ?? 0);
  const provider = history.data?.provider ?? null;
  const budget = provider ? Math.max(1, Math.floor(clipS * provider.wordsPerSecond)) : null;

  const refresh = () =>
    Promise.all([utils.chat.history.invalidate({ projectId }), utils.script.history.invalidate({ projectId }), utils.studio.getProject.invalidate({ projectId })]);
  const send = api.chat.send.useMutation({
    onSuccess: () => utils.chat.history.invalidate({ projectId }),
    // The request comes back to the field, to send again or reword.
    onError: (e, input) => {
      setError(e.message);
      setDraft((current) => current || input.message);
    },
  });
  const apply = api.chat.applyProposal.useMutation({ onSuccess: refresh, onError: (e) => setError(e.message) });
  const applyAndLaunch = api.chat.applyAndLaunch.useMutation({
    onSuccess: async () => {
      await Promise.all([refresh(), utils.generation.forProject.invalidate({ projectId })]);
      onClose();
    },
    onError: async (e) => {
      setError(e.message);
      await refresh();
    },
  });
  const busy = apply.isPending || applyAndLaunch.isPending;

  function submit(text = draft) {
    const message = text.trim();
    if (!message || send.isPending) return;
    setDraft("");
    setError(null);
    send.mutate({ projectId, message, durationS: clipS });
  }

  // The newest exchange stays in view.
  const log = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolls again whenever a message or the pending answer appears.
  useLayoutEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, send.isPending]);

  // As a sheet: focus goes to the request field, Escape closes it.
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!open) return;
    field.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const pendingIndex = [...messages].reverse().findIndex((m) => m.proposal && !m.appliedScriptId);
  const newestPendingId = pendingIndex < 0 ? null : messages[messages.length - 1 - pendingIndex]!.id;
  const versionOf = (id: string | null) => versions.find((v) => v.id === id) ?? null;
  const unavailable = provider === null ? "The script chat is not available in this studio." : provider.problem;

  return (
    <>
      {/* The sheet's backdrop, below the large breakpoint only. */}
      <div
        aria-hidden
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-black/50 transition-opacity duration-250 ease-in-out lg:hidden ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <aside
        aria-label="Script chat"
        className={`flex flex-col max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-40 max-lg:h-[88dvh] max-lg:rounded-t-[14px] max-lg:border-t max-lg:border-muted/25 max-lg:bg-bg max-lg:shadow-[0_8px_30px_rgba(0,0,0,0.16)] max-lg:transition-[transform,visibility] max-lg:duration-250 max-lg:ease-in-out motion-reduce:max-lg:transition-none lg:sticky lg:top-24 lg:h-[calc(100dvh-15rem)] lg:min-h-[28rem] lg:border-l lg:border-muted/20 lg:pl-6 ${open ? "" : "max-lg:invisible max-lg:translate-y-full"}`}
      >
        <div className="flex items-start justify-between gap-3 px-4 pt-4 lg:px-0 lg:pt-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Script chat</h2>
            <p className="mt-0.5 truncate font-mono text-xs text-muted" title={provider?.modelId}>
              {provider ? `${provider.label} · ${provider.modelId}` : " "}
              {budget ? ` · ${budget} words for ${clipS} s` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} className="-mr-2 min-h-11 rounded-lg px-3 text-sm text-muted hover:text-fg lg:hidden">
            Close
          </button>
        </div>

        <div ref={log} className="mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-2 lg:px-0 lg:pr-1">
          {history.isPending ? (
            <div className="space-y-2" role="status" aria-label="Loading the chat">
              <Skeleton className="h-10 w-2/3" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : history.error ? (
            <ErrorNote>The chat failed to load: {history.error.message}</ErrorNote>
          ) : messages.length === 0 && !send.isPending && unavailable ? null : messages.length === 0 && !send.isPending ? (
            <div className="space-y-3 text-sm">
              <p className="text-pretty text-muted">
                Ask for a change in your own words. Each answer proposes a whole new version of the script, shown against the current one; nothing changes until you apply it.
              </p>
              {demoChat && !unavailable ? <demoChat.Note /> : null}
            </div>
          ) : (
            messages.map((m) =>
              m.role === "user" ? (
                <p key={m.id} className="ml-8 whitespace-pre-wrap rounded-xl bg-surface px-3 py-2 text-sm">
                  {m.content}
                </p>
              ) : (
                <div key={m.id} className="space-y-2">
                  {m.proposal ? (
                    <>
                      <p className="text-pretty text-sm">{m.content}</p>
                      <ProposalCard
                        projectId={projectId}
                        proposal={m.proposal}
                        current={(m.appliedScriptId ? versionOf(m.baseScriptId)?.lines : latest?.lines) ?? []}
                        state={{
                          baseVersion: versionOf(m.baseScriptId)?.version ?? null,
                          appliedVersion: versionOf(m.appliedScriptId)?.version ?? null,
                          latestVersion: latest?.version ?? null,
                          newest: m.id === newestPendingId,
                        }}
                        clipS={clipS}
                        actorChange={m.proposal.actorId && m.proposal.actorId !== currentActorId && !m.appliedScriptId ? { from: actorName(currentActorId), to: actorName(m.proposal.actorId) } : null}
                        relaunch={relaunchPlan(base, estimateSeconds(m.proposal.lines.map((l) => l.text).join(" ")))}
                        busy={busy}
                        onApply={() => {
                          setError(null);
                          apply.mutate({ projectId, messageId: m.id });
                        }}
                        onApplyAndLaunch={() => {
                          const plan = relaunchPlan(base, estimateSeconds(m.proposal!.lines.map((l) => l.text).join(" ")));
                          if (!plan.ok) return;
                          setError(null);
                          applyAndLaunch.mutate({ projectId, messageId: m.id, launch: plan.request });
                        }}
                      />
                    </>
                  ) : (
                    <div className="space-y-1.5 text-sm">
                      <p className="text-pretty text-muted">The answer could not be read as a script. Ask again, perhaps in fewer words.</p>
                      <details className="group rounded-lg bg-surface px-3 py-2">
                        <summary className="cursor-pointer text-xs text-muted hover:text-fg">Show what the model wrote</summary>
                        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{m.content}</pre>
                      </details>
                    </div>
                  )}
                  {/* Said only when another model wrote it than the one answering now. */}
                  {m.model && provider && m.model !== provider.modelId ? <p className="font-mono text-[11px] text-muted">{m.model}</p> : null}
                </div>
              ),
            )
          )}
          {send.isPending ? (
            <>
              <p className="ml-8 whitespace-pre-wrap rounded-xl bg-surface px-3 py-2 text-sm">{send.variables?.message}</p>
              <div className="space-y-2" role="status">
                <p className="text-xs text-muted">{provider?.label ?? "The model"} is writing a new version…</p>
                {demoChat ? <demoChat.Progress /> : null}
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-20 w-full" />
              </div>
            </>
          ) : null}
        </div>

        <form
          className="border-t border-muted/20 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] lg:px-0 lg:pb-0"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {unavailable ? (
            <div className="mb-3">
              <ProviderWarning>
                {unavailable}{" "}
                {edition.kind === "studio" ? (
                  <Link href="/settings#script-chat" className="underline underline-offset-4">
                    Chat settings
                  </Link>
                ) : null}
              </ProviderWarning>
            </div>
          ) : null}
          {error ? (
            <div className="mb-3">
              <ErrorNote>{error}</ErrorNote>
            </div>
          ) : null}
          {messages.length === 0 && !send.isPending && !unavailable ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {(latest ? SUGGESTIONS : FIRST_SUGGESTIONS).map((s) => (
                <button key={s} type="button" onClick={() => submit(s)} className="min-h-9 rounded-md border border-muted/25 px-2.5 text-xs text-muted transition-colors duration-150 hover:border-muted/50 hover:text-fg max-lg:min-h-11">
                  {s}
                </button>
              ))}
            </div>
          ) : null}
          <label htmlFor="chat-request" className="sr-only">
            Ask for a change
          </label>
          <textarea
            id="chat-request"
            ref={field}
            rows={2}
            value={draft}
            maxLength={2000}
            disabled={Boolean(unavailable)}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={latest ? "A punchier hook, a calmer tone, another actor…" : "Describe the script you want…"}
            className="block max-h-40 w-full resize-none rounded-lg border border-muted/30 bg-bg px-3 py-2 text-sm placeholder:text-muted/80 disabled:opacity-50"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-xs text-muted">Enter sends · Shift+Enter for a new line</span>
            <button
              type="submit"
              disabled={send.isPending || !draft.trim() || Boolean(unavailable)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
            >
              {send.isPending ? "Writing…" : "Send"}
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}
