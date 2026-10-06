"use client";

import { useId, useState } from "react";

import { ErrorNote, Skeleton } from "~/app/_components/ui";
import { api } from "~/trpc/react";
import { shortfall } from "../format";

type Kind = "ideas" | "remix" | "script" | "repurpose";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

// The ideas' label names how many a set holds (the studio's setting).
const ACTIONS: { kind: Kind; label: (n: number) => string; busy: (n: number) => string; hint: string }[] = [
  { kind: "ideas", label: (n) => `${plural(n, "idea")} in this style`, busy: (n) => `Writing ${plural(n, "idea")}…`, hint: "New subjects, the same kind of hook, structure and pace." },
  { kind: "remix", label: () => "Remix the hook", busy: () => "Remixing the hook…", hint: "Openings that work the way this one does." },
  { kind: "repurpose", label: () => "Cut into short scripts", busy: () => "Cutting it up…", hint: "Short scripts, each built on one moment of it." },
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
  const [short, setShort] = useState<string | null>(null);
  const generate = api.library.ideas.generate.useMutation({
    onSuccess: (written, input) => {
      setShort(shortfall(input.count ?? written.length, written.length, input.kind));
      return utils.library.ideas.list.invalidate();
    },
    onError: (e) => setError(e.message),
  });
  // How many a set holds: the studio says it for ideas (TROUPE_LIBRARY_IDEAS,
  // or the browser edition's); the browser's small model writes fewer
  // remixes and cuts too, within its context. Asked for explicitly, so a set
  // cut short can say how many it has.
  const ideaCount = status.data?.ideas ?? null;
  const count = (kind: Kind) => ({ ideas: ideaCount ?? 1, remix: browser ? 3 : 5, script: 1, repurpose: browser ? 2 : 3 })[kind];
  const run = (kind: Kind, extra: { actorId?: string } = {}) => {
    setError(null);
    setShort(null);
    generate.mutate({ workspaceId, kind, itemIds: [itemId], count: count(kind), ...extra });
  };
  const pending = generate.isPending ? generate.variables?.kind : null;

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {ACTIONS.map((a) => (
          <li key={a.kind} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {/* Until the studio says how many ideas a set holds, no number is guessed. */}
            {a.kind === "ideas" && ideaCount === null ? (
              <Skeleton className="h-10 w-44 rounded-lg" />
            ) : (
              <button
                type="button"
                aria-describedby={`${hintId}-${a.kind}`}
                disabled={!usable || generate.isPending}
                onClick={() => run(a.kind)}
                className="min-h-10 rounded-lg border border-muted/30 px-3 text-sm transition-colors duration-150 hover:border-muted/60 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pending === a.kind ? a.busy(count(a.kind)) : a.label(count(a.kind))}
              </button>
            )}
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
      {short ? (
        <p role="status" className="text-pretty text-xs text-muted">
          {short}
        </p>
      ) : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </div>
  );
}
