"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, ButtonLink, ErrorNote, Skeleton } from "~/app/_components/ui";
import { api } from "~/trpc/react";
import { IDEA_LABELS } from "./format";

type Idea = {
  id: string;
  kind: keyof typeof IDEA_LABELS;
  title: string;
  hook: string;
  lines: { role: "hook" | "body" | "cta"; text: string; emotion: string }[];
  itemIds: string[];
  actorId: string | null;
  projectId: string | null;
  model: string | null;
  createdAt: Date;
};

const words = (lines: Idea["lines"]) => lines.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0);

function IdeaCard({
  idea,
  workspaceId,
  titles,
  actors,
}: {
  idea: Idea;
  workspaceId: string;
  titles: Map<string, string>;
  actors: Map<string, string>;
}) {
  const router = useRouter();
  const utils = api.useUtils();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const create = api.library.ideas.createProject.useMutation({
    onSuccess: async ({ projectId }) => {
      await Promise.all([utils.library.ideas.list.invalidate(), utils.identity.projects.invalidate()]);
      router.push(`/projects/${projectId}`);
    },
    onError: (e) => setError(e.message),
  });
  const remove = api.library.ideas.delete.useMutation({
    onSuccess: () => utils.library.ideas.list.invalidate(),
    onError: (e) => setError(e.message),
  });
  const count = words(idea.lines);
  const sources = idea.itemIds.map((id) => titles.get(id)).filter(Boolean);
  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold">{idea.title}</h3>
        <p className="font-mono text-xs tabular-nums text-muted">
          {count} words · about {Math.max(1, Math.ceil(count / 2.5))} s
        </p>
      </div>
      <ol className="space-y-1 text-sm">
        {idea.lines.map((line, i) => (
          <li key={i} className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-2">
            <span className="pt-0.5 font-mono text-[11px] uppercase tracking-wide text-muted">
              {line.role === "cta" ? "call" : line.role}
            </span>
            <span className={line.role === "hook" ? "font-medium" : "text-fg/90"}>{line.text}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {idea.projectId ? (
          <ButtonLink href={`/projects/${idea.projectId}`} size="sm">
            Open project
          </ButtonLink>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={create.isPending}
            onClick={() => {
              setError(null);
              create.mutate({ workspaceId, ideaId: idea.id });
            }}
          >
            {create.isPending ? "Creating…" : "Create project"}
          </Button>
        )}
        <p className="min-w-0 flex-1 truncate text-xs text-muted">
          {IDEA_LABELS[idea.kind]}
          {sources.length ? ` · from ${sources.join(", ")}` : ""}
          {idea.actorId && actors.get(idea.actorId) ? ` · for ${actors.get(idea.actorId)}` : ""}
        </p>
        {confirming ? (
          <span className="flex items-center gap-2 text-xs">
            <Button
              variant="danger"
              size="sm"
              onClick={() => remove.mutate({ workspaceId, ideaId: idea.id })}
              disabled={remove.isPending}
            >
              Delete idea
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </span>
        ) : (
          <Button variant="quiet" size="sm" onClick={() => setConfirming(true)}>
            Delete
          </Button>
        )}
      </div>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </li>
  );
}

// Idea cards: each a whole short script, made into a project in one click.
export function IdeaCards({ workspaceId, itemId, empty }: { workspaceId: string; itemId?: string; empty: string }) {
  const ideas = api.library.ideas.list.useQuery({ workspaceId, ...(itemId ? { itemId } : {}) });
  const items = api.library.list.useQuery({ workspaceId }, { enabled: !itemId, staleTime: 30_000 });
  const actors = api.actors.list.useQuery(undefined, { staleTime: 5 * 60_000 });
  if (ideas.isPending) return <Skeleton className="h-32 w-full" />;
  if (ideas.error) return <ErrorNote>The ideas failed to load: {ideas.error.message}</ErrorNote>;
  if (ideas.data.length === 0) return <p className="max-w-[72ch] text-sm text-muted">{empty}</p>;
  const titles = new Map((items.data ?? []).map((i) => [i.id, i.title]));
  const names = new Map((actors.data ?? []).map((a) => [a.id, a.name]));
  return (
    <ul className="divide-y divide-line">
      {(ideas.data as Idea[]).map((idea) => (
        <IdeaCard
          key={idea.id}
          idea={idea}
          workspaceId={workspaceId}
          titles={itemId ? new Map() : titles}
          actors={names}
        />
      ))}
    </ul>
  );
}
