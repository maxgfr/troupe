"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { errorText } from "~/app/_components/errors";
import { usePageTitle } from "~/app/_components/page-title";
import {
  Button,
  ErrorNote,
  PageHeader,
  ProviderWarning,
  SignedOutNotice,
  Skeleton,
  chipClass,
  fieldClass,
  panelClass,
} from "~/app/_components/ui";
import { useWorkspace } from "~/app/_components/workspace-context";
import { api } from "~/trpc/react";

// The studio assistant: ask in words, it does it with the studio's own tools
// (src/server/assistant) on your OpenRouter key. Anything that costs money
// waits for your Confirm, with its price. The conversation stays in this
// browser (localStorage), one per workspace.

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
type Pending = { toolCallId: string; tool: string; summary: string; estimatedCostUsd: number | null };
type Outcome = { ok: boolean; summary: string; link?: { label: string; href: string } };

const SUGGESTIONS = [
  "Create a 28-year-old female lifestyle influencer with curly red hair",
  "Which OpenRouter video models can I add, and what do they cost?",
  "Make a 10 s TikTok about a folding coffee cup with Fatou",
];

const storageKey = (workspaceId: string) => `troupe-assistant:${workspaceId}`;

function readSaved(workspaceId: string): { messages: Message[]; pending: Pending | null } {
  try {
    const raw = localStorage.getItem(storageKey(workspaceId));
    const parsed = raw ? (JSON.parse(raw) as { messages?: Message[]; pending?: Pending | null }) : null;
    return { messages: Array.isArray(parsed?.messages) ? parsed.messages : [], pending: parsed?.pending ?? null };
  } catch {
    return { messages: [], pending: null };
  }
}

function outcomeOf(content: string): Outcome {
  try {
    const o = JSON.parse(content) as Outcome;
    return typeof o.summary === "string" ? o : { ok: true, summary: content };
  } catch {
    return { ok: true, summary: content };
  }
}

const TOOL_LABELS: Record<string, string> = {
  list_actors: "Looked at the actors",
  create_actor: "Made an actor",
  list_models: "Looked at the models",
  search_catalog: "Searched the model lists",
  add_model: "Added a model",
  list_projects: "Looked at the projects",
  create_project: "Created a project",
  set_script: "Saved a script",
  launch_render: "Launched a render",
  render_status: "Checked the renders",
  launch_video_shot: "Launched a video shot",
  launch_photo: "Drew a photo",
  launch_voice: "Said a line",
  list_shots: "Looked at the shots",
};

export default function AssistantPage() {
  usePageTitle("Assistant");
  const workspace = useWorkspace();
  if (workspace.status === "unauthenticated") return <SignedOutNotice />;
  return (
    <>
      <PageHeader
        title="Assistant"
        lede="Ask in your own words: it makes actors, adds models, writes scripts, renders and draws, with your OpenRouter key. Anything that costs money waits for your Confirm."
      />
      {workspace.status === "ready" ? (
        <Assistant workspaceId={workspace.workspaceId} />
      ) : workspace.status === "error" ? (
        <ErrorNote>{workspace.message}</ErrorNote>
      ) : (
        <Skeleton className="h-64 w-full max-w-3xl" />
      )}
    </>
  );
}

function Assistant({ workspaceId }: { workspaceId: string }) {
  const fieldId = useId();
  const status = api.assistant.status.useQuery({ workspaceId });
  const utils = api.useUtils();
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  useEffect(() => {
    const saved = readSaved(workspaceId);
    setMessages(saved.messages);
    setPending(saved.pending);
    loaded.current = true;
  }, [workspaceId]);
  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(storageKey(workspaceId), JSON.stringify({ messages, pending }));
    } catch {
      // Storage full or off: the conversation lasts as long as the page.
    }
  }, [workspaceId, messages, pending]);
  // Down to the newest turn as it arrives.
  const turns = messages.length + (pending ? 1 : 0);
  useEffect(() => {
    if (turns) log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [turns]);

  const after = (result: { messages: Message[]; pending: Pending | null }) => {
    setMessages(result.messages);
    setPending(result.pending);
    // What the tools changed shows on the other pages at once.
    void utils.invalidate();
  };
  const send = api.assistant.send.useMutation({ onSuccess: after, onError: (e) => setError(errorText(e)) });
  const decide = api.assistant.decide.useMutation({ onSuccess: after, onError: (e) => setError(errorText(e)) });
  const busy = send.isPending || decide.isPending;

  const submit = (text: string) => {
    const content = text.trim();
    if (!content || busy || pending) return;
    setError(null);
    const next: Message[] = [...messages, { role: "user", content }];
    setMessages(next);
    setDraft("");
    send.mutate({ workspaceId, messages: next });
  };

  const results = new Map(messages.flatMap((m) => (m.role === "tool" ? [[m.tool_call_id, outcomeOf(m.content)]] : [])));

  if (status.isPending) return <Skeleton className="h-64 w-full max-w-3xl" />;

  return (
    <div className={`${panelClass} flex max-w-3xl flex-col p-4 sm:p-5`}>
      {status.data && !status.data.ready ? (
        <div className="mb-3">
          <ProviderWarning>
            {status.data.problem}{" "}
            <Link href="/settings#provider-accounts" className="underline underline-offset-4">
              Provider accounts
            </Link>
          </ProviderWarning>
        </div>
      ) : null}

      <div
        ref={log}
        role="log"
        aria-label="The assistant"
        className="max-h-[60vh] min-h-48 space-y-3 overflow-y-auto pr-1"
      >
        {messages.length === 0 ? (
          <div className="space-y-3 text-sm">
            <p className="text-pretty text-muted">
              Try one of these, or ask for anything the studio does. It answers with{" "}
              <span className="font-mono text-xs">{status.data?.model}</span>; change it in Settings → Script chat.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy || !status.data?.ready}
                  onClick={() => submit(s)}
                  className={chipClass(false, "text-left", "sm")}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => {
            if (m.role === "user")
              return (
                <p
                  key={i}
                  className="ml-8 whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary/12 px-3.5 py-2 text-sm"
                >
                  {m.content}
                </p>
              );
            if (m.role === "tool") return null;
            return (
              <div key={i} className="space-y-1.5">
                {m.content ? <p className="whitespace-pre-wrap text-pretty text-sm">{m.content}</p> : null}
                {(m.tool_calls ?? []).map((c) => {
                  const outcome = results.get(c.id);
                  const waiting = pending?.toolCallId === c.id;
                  return (
                    <div key={c.id} className="rounded-xl border border-border/60 px-3 py-2 text-xs">
                      <p className="font-medium">
                        {outcome ? (outcome.ok ? "✓ " : "✗ ") : waiting ? "… " : ""}
                        {TOOL_LABELS[c.function.name] ?? c.function.name}
                      </p>
                      {outcome ? (
                        <p className={`mt-0.5 ${outcome.ok ? "text-muted" : "text-danger"}`}>
                          {outcome.summary}
                          {outcome.link ? (
                            <>
                              {" "}
                              <Link href={outcome.link.href} className="underline underline-offset-4">
                                {outcome.link.label}
                              </Link>
                            </>
                          ) : null}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
        {pending ? (
          <div
            role="group"
            aria-label="Confirm"
            className="rounded-xl border border-primary/50 bg-primary/8 p-3 text-sm"
          >
            <p className="font-medium">Confirm before it runs</p>
            <p className="mt-1 text-pretty">{pending.summary}</p>
            <p className="mt-1 text-xs text-muted">
              {pending.estimatedCostUsd === null
                ? "The provider lists no price for this; it bills your account."
                : pending.estimatedCostUsd === 0
                  ? "Free."
                  : `Estimated cost: $${pending.estimatedCostUsd.toFixed(pending.estimatedCostUsd < 0.1 ? 3 : 2)}, billed to your account.`}
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  decide.mutate({ workspaceId, messages, toolCallId: pending.toolCallId, approve: true });
                }}
              >
                {decide.isPending && decide.variables?.approve ? "Running…" : "Confirm"}
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  decide.mutate({ workspaceId, messages, toolCallId: pending.toolCallId, approve: false });
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
        {send.isPending ? (
          <p role="status" className="text-xs text-muted">
            Working…
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      ) : null}

      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        <label htmlFor={fieldId} className="sr-only">
          Ask the assistant
        </label>
        <textarea
          id={fieldId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(draft);
            }
          }}
          rows={2}
          maxLength={8000}
          disabled={!status.data?.ready}
          placeholder={
            busy ? "Working…" : pending ? "Confirm or cancel first." : "Ask for an actor, a script, a render…"
          }
          className={`${fieldClass} flex-1 resize-none`}
        />
        <div className="flex flex-col gap-1.5">
          <Button
            type="submit"
            variant="primary"
            disabled={busy || Boolean(pending) || !draft.trim() || !status.data?.ready}
          >
            Send
          </Button>
          {messages.length ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                setMessages([]);
                setPending(null);
                setError(null);
              }}
            >
              New
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
