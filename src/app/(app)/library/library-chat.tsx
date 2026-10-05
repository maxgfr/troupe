"use client";

import Link from "next/link";
import { Fragment, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { useEdition } from "~/app/_components/edition";
import { ErrorNote, ProviderWarning, Skeleton } from "~/app/_components/ui";
import { api } from "~/trpc/react";
import { clock } from "./format";

interface Citation {
  n: number;
  itemId: string;
  title: string;
  startS: number | null;
}

const LIBRARY_SUGGESTIONS = ["Which hooks open with a question?", "What do these videos have in common?", "Which structures keep people watching?"];
const ITEM_SUGGESTIONS = ["Why does this hook work?", "Walk me through its structure", "What could I reuse in my own videos?"];

// An answer with its [n] markers as links to the passages they cite.
function Cited({ text, citations, href, follow }: { text: string; citations: Citation[]; href: (c: Citation) => string; follow: (c: Citation) => (event: React.MouseEvent) => void }) {
  const parts = text.split(/(\[\d{1,2}\])/g);
  return (
    <p className="whitespace-pre-wrap text-pretty text-sm leading-relaxed">
      {parts.map((part, i) => {
        const n = /^\[(\d{1,2})\]$/.exec(part)?.[1];
        const cited = n ? citations.find((c) => c.n === Number(n)) : undefined;
        if (!cited) return <Fragment key={i}>{part}</Fragment>;
        return (
          <Link
            key={i}
            href={href(cited)}
            onClick={follow(cited)}
            aria-label={`Source ${cited.n}: ${cited.title}${cited.startS !== null ? ` at ${clock(cited.startS)}` : ""}`}
            className="relative mx-0.5 inline-flex min-w-5 items-center justify-center rounded-md bg-primary/15 px-1 align-[1px] font-mono text-[11px] tabular-nums text-primary transition-colors duration-150 after:absolute after:-inset-x-2.5 after:-inset-y-3 hover:bg-primary/25"
          >
            {cited.n}
          </Link>
        );
      })}
    </p>
  );
}

// The library chat: about the whole library, or one item (itemId). Each
// answer cites the passages it used; a citation opens the item at its time.
export function LibraryChat({
  workspaceId,
  itemId,
  heading = (title) => <h2 className="text-base font-semibold">{title}</h2>,
  onSeek,
}: {
  workspaceId: string;
  itemId?: string;
  heading?: (title: string) => ReactNode;
  // On an item's page, a citation of that item seeks its player instead.
  onSeek?: (seconds: number) => void;
}) {
  const fieldId = useId();
  const edition = useEdition();
  const browserChat = edition.kind === "browser" ? edition.chat : undefined;
  const utils = api.useUtils();
  const history = api.library.chat.history.useQuery({ workspaceId, itemId: itemId ?? null }, { retry: false });
  const messages = history.data?.messages ?? [];
  const writer = history.data?.writer ?? null;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const send = api.library.chat.send.useMutation({
    onSuccess: () => utils.library.chat.history.invalidate({ workspaceId, itemId: itemId ?? null }),
    onError: (e, input) => {
      setError(e.message);
      setDraft((current) => current || input.message);
    },
  });
  const clear = api.library.chat.clear.useMutation({ onSuccess: () => utils.library.chat.history.invalidate({ workspaceId, itemId: itemId ?? null }) });

  function submit(text = draft) {
    const message = text.trim();
    if (!message || send.isPending) return;
    setDraft("");
    setError(null);
    send.mutate({ workspaceId, itemId: itemId ?? null, message });
  }

  const log = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolls again whenever a message or the pending answer appears.
  useLayoutEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, send.isPending]);

  // Said once the history is in: while it loads, nothing is known yet.
  const unavailable = !history.data ? null : writer === null ? "No chat model is set up, and the library chat answers with it." : writer.problem;
  const href = (c: Citation) => (c.itemId === itemId && onSeek ? "#" : `/library/${c.itemId}${c.startS !== null ? `?t=${Math.floor(c.startS)}` : ""}`);
  const follow = (c: Citation) => (event: React.MouseEvent) => {
    if (c.itemId === itemId && onSeek && c.startS !== null) {
      event.preventDefault();
      onSeek(c.startS);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {heading(itemId ? "Ask about this item" : "Ask your library")}
          <p className="mt-0.5 truncate font-mono text-xs text-muted" title={writer?.modelId}>
            {writer ? `${writer.label} · ${writer.modelId}` : " "}
          </p>
        </div>
        {messages.length > 0 ? (
          <button type="button" onClick={() => clear.mutate({ workspaceId, itemId: itemId ?? null })} disabled={clear.isPending || send.isPending} className="-mr-2 min-h-9 shrink-0 rounded-lg px-2 text-xs text-muted transition-colors duration-150 hover:text-fg disabled:opacity-40">
            Clear
          </button>
        ) : null}
      </div>

      <div ref={log} className="mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pr-1 pb-2">
        {history.isPending ? (
          <div className="space-y-2" role="status" aria-label="Loading the chat">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : history.error ? (
          <ErrorNote>The chat failed to load: {history.error.message}</ErrorNote>
        ) : messages.length === 0 && !send.isPending ? (
          unavailable ? null : (
            <div className="space-y-3 text-sm">
              <p className="text-pretty text-muted">
                {itemId
                  ? "Ask what makes it work. Answers come from its transcript, its pictures and its analysis, with the moments they cite."
                  : "Ask across everything you saved. Each answer cites the passages it comes from; a citation opens the item at that moment."}
              </p>
              {browserChat ? <browserChat.Note /> : null}
            </div>
          )
        ) : (
          messages.map((m) =>
            m.role === "user" ? (
              <p key={m.id} className="ml-8 whitespace-pre-wrap rounded-xl bg-surface px-3 py-2 text-sm">
                {m.content}
              </p>
            ) : (
              <div key={m.id} className="space-y-2">
                <Cited text={m.content} citations={m.citations} href={href} follow={follow} />
                {m.citations.length > 0 ? (
                  <ul aria-label="Sources" className="flex flex-wrap gap-1.5">
                    {m.citations.map((c) => (
                      <li key={c.n}>
                        <Link href={href(c)} onClick={follow(c)} className="inline-flex min-h-8 max-w-[16rem] items-center gap-1.5 rounded-md border border-muted/25 px-2 text-xs transition-colors duration-150 hover:border-muted/50">
                          <span className="font-mono tabular-nums text-primary">{c.n}</span>
                          <span className="truncate">{c.title}</span>
                          {c.startS !== null ? <span className="font-mono tabular-nums text-muted">{clock(c.startS)}</span> : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {m.model && writer && m.model !== writer.modelId ? <p className="font-mono text-[11px] text-muted">{m.model}</p> : null}
              </div>
            ),
          )
        )}
        {send.isPending ? (
          <>
            <p className="ml-8 whitespace-pre-wrap rounded-xl bg-surface px-3 py-2 text-sm">{send.variables?.message}</p>
            <div className="space-y-2" role="status">
              <p className="text-xs text-muted">{writer?.label ?? "The model"} is reading your library…</p>
              {browserChat ? <browserChat.Progress /> : null}
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-12 w-full" />
            </div>
          </>
        ) : null}
      </div>

      <form
        className="border-t border-muted/20 pt-3"
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
        {history.data && messages.length === 0 && !send.isPending && !unavailable ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {(itemId ? ITEM_SUGGESTIONS : LIBRARY_SUGGESTIONS).map((s) => (
              <button key={s} type="button" onClick={() => submit(s)} className="min-h-9 rounded-md border border-muted/25 px-2.5 text-left text-xs text-muted transition-colors duration-150 hover:border-muted/50 hover:text-fg max-lg:min-h-11">
                {s}
              </button>
            ))}
          </div>
        ) : null}
        <label htmlFor={fieldId} className="sr-only">
          {itemId ? "Ask about this item" : "Ask your library"}
        </label>
        <textarea
          id={fieldId}
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
          placeholder={itemId ? "What makes the first three seconds work?" : "Which saved videos open on a bold claim?"}
          className="block max-h-40 w-full resize-none rounded-lg border border-muted/30 bg-bg px-3 py-2 text-sm placeholder:text-muted/80 disabled:opacity-50"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs text-muted max-sm:hidden">Enter sends · Shift+Enter for a new line</span>
          <button type="submit" disabled={send.isPending || !draft.trim() || Boolean(unavailable)} className="ml-auto rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-opacity duration-150 hover:opacity-90 disabled:opacity-40">
            {send.isPending ? "Reading…" : "Ask"}
          </button>
        </div>
      </form>
    </div>
  );
}
