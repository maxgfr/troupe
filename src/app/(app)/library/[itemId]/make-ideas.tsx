"use client";

import { useId, useState } from "react";

import { ErrorNote, Skeleton } from "~/app/_components/ui";
import { api } from "~/trpc/react";

type Kind = "ideas" | "remix" | "script" | "repurpose";

const ACTIONS: { kind: Kind; label: string; busy: string; hint: string }[] = [
  { kind: "ideas", label: "10 ideas in this style", busy: "Writing 10 ideas…", hint: "New subjects, the same kind of hook, structure and pace." },
  { kind: "remix", label: "Remix the hook", busy: "Remixing the hook…", hint: "Five openings that work the way this one does." },
  { kind: "repurpose", label: "Cut into short scripts", busy: "Cutting it up…", hint: "Three scripts, each built on one moment of it." },
];

// What the library writes from this item: idea cards, each a whole script
// that becomes a project in one click (the list below the actions).
export function MakeIdeas({ workspaceId, itemId, ready, browser }: { workspaceId: string; itemId: string; ready: boolean; browser: boolean }) {
  const actorField = useId();
  const hintId = useId();
  const utils = api.useUtils();
  // The chat model writes the ideas: without one, the buttons say why.
  const status = api.library.status.useQuery(undefined, { retry: false, staleTime: 30_000 });
  const writer = status.data?.tools.find((t) => t.name === "writer");
  const noWriter = writer && !writer.ready ? writer.detail : null;
  const usable = ready && !noWriter;
  const actors = api.actors.list.useQuery(undefined, { staleTime: 5 * 60_000 });
  const available = (actors.data ?? []).filter((a) => a.status === "active");
  const [actorId, setActorId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const generate = api.library.ideas.generate.useMutation({
    onSuccess: () => utils.library.ideas.list.invalidate(),
    onError: (e) => setError(e.message),
  });
  // The browser's small model writes fewer at a time, within its context.
  const count = (kind: Kind) => (browser ? { ideas: 5, remix: 3, script: 1, repurpose: 2 }[kind] : undefined);
  const run = (kind: Kind, extra: { actorId?: string } = {}) => {
    setError(null);
    generate.mutate({ workspaceId, kind, itemIds: [itemId], ...(count(kind) ? { count: count(kind) } : {}), ...extra });
  };
  const pending = generate.isPending ? generate.variables?.kind : null;
  const label = (a: (typeof ACTIONS)[number]) => (pending === a.kind ? a.busy : browser && a.kind === "ideas" ? "5 ideas in this style" : a.label);

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {ACTIONS.map((a) => (
          <li key={a.kind} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <button
              type="button"
              aria-describedby={`${hintId}-${a.kind}`}
              disabled={!usable || generate.isPending}
              onClick={() => run(a.kind)}
              className="min-h-10 rounded-lg border border-muted/30 px-3 text-sm transition-colors duration-150 hover:border-muted/60 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {label(a)}
            </button>
            <span id={`${hintId}-${a.kind}`} className="text-pretty text-xs text-muted">
              {a.hint}
            </span>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (actorId) run("script", { actorId });
        }}
      >
        <label htmlFor={actorField} className="block text-sm">
          <span className="mb-1 block text-xs text-muted">A script for one actor</span>
          <select id={actorField} value={actorId} onChange={(e) => setActorId(e.target.value)} className="min-h-10 rounded-lg border border-muted/30 bg-bg px-3 text-sm">
            <option value="">Choose an actor</option>
            {available.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.ageRange}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={!usable || !actorId || generate.isPending} className="min-h-10 rounded-lg border border-muted/30 px-3 text-sm transition-colors duration-150 hover:border-muted/60 disabled:cursor-not-allowed disabled:opacity-40">
          {pending === "script" ? "Writing the script…" : "Write the script"}
        </button>
      </form>
      {!ready ? <p className="text-xs text-muted">Available once the item is read.</p> : noWriter ? <p className="text-pretty text-xs text-muted">Ideas are written by the chat model, which cannot run: {noWriter}</p> : null}
      {generate.isPending ? (
        <div role="status" className="space-y-2">
          <p className="text-xs text-muted">The chat model is writing; small models on a CPU can take a minute.</p>
          <Skeleton className="h-16 w-full" />
        </div>
      ) : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </div>
  );
}
