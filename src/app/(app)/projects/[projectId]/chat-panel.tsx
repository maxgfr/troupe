"use client";

import { errorText } from "~/app/_components/errors";
import Link from "next/link";
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { useEdition } from "~/app/_components/edition";
import { Button, ErrorNote, ProviderWarning, Skeleton, chipClass, fieldClass } from "~/app/_components/ui";
import { api } from "~/trpc/react";
import { chatClipSeconds, relaunchPlan, type ChatLaunchBase } from "./chat-launch";
import { ProposalCard } from "./chat-proposal";
import { estimateSeconds } from "./script/estimate";

type Line = {
  role: "hook" | "body" | "cta";
  text: string;
  emotion: "neutral" | "excited" | "calm" | "serious" | "happy" | "disappointed";
};
export interface ScriptVersion {
  id: string;
  version: number;
  estimatedDurationS: number;
  lines: Line[];
}

const SUGGESTIONS = ["Make the hook punchier", "Cut it to fit the clip", "Warmer, calmer delivery"];
const FIRST_SUGGESTIONS = ["Write a 3-line script for this project"];

// The project's iteration chat: a column that fills its container. The
// project page puts it beside the timeline on wide screens, and in a drawer
// (a modal dialog) below that, which supplies the heading and a close button.
export function ChatPanel({
  projectId,
  versions,
  base,
  currentActorId,
  heading = (title) => <h2 className="text-xl font-semibold tracking-[-0.01em]">{title}</h2>,
  closeButton,
  onLaunched,
}: {
  projectId: string;
  versions: ScriptVersion[];
  base: ChatLaunchBase | null;
  currentActorId: string | null;
  heading?: (title: string) => ReactNode;
  closeButton?: ReactNode;
  // After Apply & relaunch, so a drawer can close onto the timeline.
  onLaunched?: () => void;
}) {
  const fieldId = useId();
  const edition = useEdition();
  const browserChat = edition.kind === "browser" ? edition.chat : undefined;
  const utils = api.useUtils();
  const history = api.chat.history.useQuery({ projectId }, { retry: false });
  const messages = history.data?.messages ?? [];
  // Each answer has a name of its own for assistive technology: "Answer 3".
  const answerNumber = new Map(messages.filter((m) => m.role === "assistant").map((m, i) => [m.id, i + 1]));
  const recasts = messages.some((m) => m.proposal?.actorId);
  const actors = api.actors.list.useQuery(undefined, { enabled: recasts, staleTime: 5 * 60_000 });
  const actorName = (id: string | null | undefined) =>
    id ? (actors.data?.find((a) => a.id === id)?.name ?? "another actor") : "no actor";

  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const latest = versions.at(-1) ?? null;
  const clipS = chatClipSeconds(base, latest?.estimatedDurationS ?? 0);
  const provider = history.data?.provider ?? null;
  const budget = provider ? Math.max(1, Math.floor(clipS * provider.wordsPerSecond)) : null;

  const refresh = () =>
    Promise.all([
      utils.chat.history.invalidate({ projectId }),
      utils.script.history.invalidate({ projectId }),
      utils.studio.getProject.invalidate({ projectId }),
    ]);
  const send = api.chat.send.useMutation({
    onSuccess: () => utils.chat.history.invalidate({ projectId }),
    // The request comes back to the field, to send again or reword.
    onError: (e, input) => {
      setError(errorText(e));
      setDraft((current) => current || input.message);
    },
  });
  const apply = api.chat.applyProposal.useMutation({ onSuccess: refresh, onError: (e) => setError(errorText(e)) });
  const applyAndLaunch = api.chat.applyAndLaunch.useMutation({
    onSuccess: async () => {
      await Promise.all([refresh(), utils.generation.forProject.invalidate({ projectId })]);
      onLaunched?.();
    },
    onError: async (e) => {
      setError(errorText(e));
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

  const field = useRef<HTMLTextAreaElement>(null);

  const pendingIndex = [...messages].reverse().findIndex((m) => m.proposal && !m.appliedScriptId);
  const newestPendingId = pendingIndex < 0 ? null : messages[messages.length - 1 - pendingIndex]!.id;
  const versionOf = (id: string | null) => versions.find((v) => v.id === id) ?? null;
  const unavailable = provider === null ? "The script chat is not available in this studio." : provider.problem;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {heading("Script chat")}
          <p className="mt-0.5 truncate font-mono text-xs text-muted" title={provider?.modelId}>
            {provider ? `${provider.label} · ${provider.modelId}` : "\u00a0"}
            {budget ? ` · ${budget} words for ${clipS} s` : ""}
          </p>
        </div>
        {closeButton}
      </div>

      {/* drawer-body: a drag here scrolls the log instead of closing the drawer. */}
      <div
        ref={log}
        role="log"
        aria-label="The script chat"
        data-slot="drawer-body"
        className="mt-3 min-h-0 flex-1 touch-pan-y space-y-4 overflow-y-auto overscroll-contain pr-1 pb-2"
      >
        {history.isPending ? (
          <div className="space-y-2" role="status" aria-label="Loading the chat">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : history.error ? (
          <ErrorNote>The chat failed to load: {errorText(history.error)}</ErrorNote>
        ) : messages.length === 0 && !send.isPending && unavailable ? null : messages.length === 0 &&
          !send.isPending ? (
          <div className="space-y-3 text-sm">
            <p className="text-pretty text-muted">
              Ask for a change in your own words. Each answer proposes a whole new version of the script, shown against
              the current one; nothing changes until you apply it.
            </p>
            {browserChat && !unavailable ? <browserChat.Note /> : null}
          </div>
        ) : (
          messages.map((m) =>
            m.role === "user" ? (
              <p
                key={m.id}
                className="ml-8 whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary/12 px-3.5 py-2 text-sm"
              >
                {m.content}
              </p>
            ) : (
              <article key={m.id} aria-label={`Answer ${answerNumber.get(m.id)}`} className="space-y-2">
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
                      actorChange={
                        m.proposal.actorId && m.proposal.actorId !== currentActorId && !m.appliedScriptId
                          ? {
                              from: actorName(currentActorId),
                              to: actorName(m.proposal.actorId),
                              toId: m.proposal.actorId,
                              toPortrait: actors.data?.find((a) => a.id === m.proposal?.actorId)?.portraitUrl,
                            }
                          : null
                      }
                      relaunch={relaunchPlan(base, estimateSeconds(m.proposal.lines.map((l) => l.text).join(" ")))}
                      busy={busy}
                      onApply={() => {
                        setError(null);
                        apply.mutate({ projectId, messageId: m.id });
                      }}
                      onApplyAndLaunch={() => {
                        const plan = relaunchPlan(
                          base,
                          estimateSeconds(m.proposal!.lines.map((l) => l.text).join(" ")),
                        );
                        if (!plan.ok) return;
                        setError(null);
                        applyAndLaunch.mutate({ projectId, messageId: m.id, launch: plan.request });
                      }}
                    />
                  </>
                ) : (
                  <div className="space-y-1.5 text-sm">
                    <p className="text-pretty text-muted">
                      The answer could not be read as a script. Ask again, perhaps in fewer words.
                    </p>
                    <details className="group rounded-lg bg-surface px-3 py-2">
                      <summary className="cursor-pointer text-xs text-muted hover:text-fg">
                        Show what the model wrote
                      </summary>
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">
                        {m.content}
                      </pre>
                    </details>
                  </div>
                )}
                {/* Said only when another model wrote it than the one answering now. */}
                {m.model && provider && m.model !== provider.modelId ? (
                  <p className="font-mono text-[11px] text-muted">{m.model}</p>
                ) : null}
              </article>
            ),
          )
        )}
        {send.isPending ? (
          <>
            <p className="ml-8 whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary/12 px-3.5 py-2 text-sm">
              {send.variables?.message}
            </p>
            <div className="space-y-2" role="status">
              <p className="text-xs text-muted">{provider?.label ?? "The model"} is writing a new version…</p>
              {browserChat ? <browserChat.Progress /> : null}
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-20 w-full" />
            </div>
          </>
        ) : null}
      </div>

      <form
        className="border-t border-line pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {unavailable ? (
          <div className="mb-3">
            <ProviderWarning>
              {unavailable}{" "}
              {edition.kind === "self-hosted" ? (
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
              <button
                key={s}
                type="button"
                onClick={() => submit(s)}
                className={chipClass(false, "max-lg:min-h-11", "sm")}
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}
        <label htmlFor={fieldId} className="sr-only">
          Ask for a change
        </label>
        <textarea
          id={fieldId}
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
          className={`${fieldClass} block max-h-40 resize-none`}
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs text-muted">Enter sends · Shift+Enter for a new line</span>
          <Button type="submit" variant="primary" disabled={send.isPending || !draft.trim() || Boolean(unavailable)}>
            {send.isPending ? "Writing…" : "Send"}
          </Button>
        </div>
      </form>
    </div>
  );
}
