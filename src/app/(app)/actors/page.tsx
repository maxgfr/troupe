"use client";

import { errorText } from "~/app/_components/errors";
import { ActorGrid, type LibraryActor } from "./actor-grid";
import { CreateActor } from "./create-actor";
import { useWorkspace } from "~/app/_components/workspace-context";
import { useState } from "react";

import { api } from "~/trpc/react";
import { usePageTitle } from "~/app/_components/page-title";
import { ErrorNote, PageHeader, Section, SignedOutNotice, Skeleton, chipClass } from "~/app/_components/ui";

const GENDERS = ["female", "male", "nonbinary"] as const;

export default function ActorsPage() {
  usePageTitle("Actors");
  const [gender, setGender] = useState<string | undefined>();
  const actors = api.actors.list.useQuery(gender ? { gender } : undefined, { retry: false });
  const workspace = useWorkspace();
  const utils = api.useUtils();
  const remove = api.actors.delete.useMutation({ onSuccess: () => utils.actors.list.invalidate() });

  return (
    <>
      <PageHeader
        title="Actors"
        lede="Each actor is a look and a voice. The local renderers show these pictures; video models that take a picture start from the actor's portrait, and talking-photo models make it speak, so the face stays the same. Make your own with a photo model on your key."
      />

      {workspace.status === "ready" ? (
        <div className="mb-8">
          <CreateActor workspaceId={workspace.workspaceId} />
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Filter by gender">
        <button
          type="button"
          onClick={() => setGender(undefined)}
          aria-pressed={gender === undefined}
          className={chipClass(gender === undefined)}
        >
          All
        </button>
        {GENDERS.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGender(g)}
            aria-pressed={gender === g}
            className={chipClass(gender === g, "capitalize")}
          >
            {g}
          </button>
        ))}
      </div>

      <Section>
        {actors.isPending ? (
          <div
            role="status"
            aria-label="Loading"
            className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-6"
          >
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="space-y-3">
                <Skeleton className="aspect-[4/5] w-full rounded-xl" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        ) : actors.error ? (
          actors.error.data?.code === "UNAUTHORIZED" ? (
            <SignedOutNotice />
          ) : (
            <ErrorNote>The library failed to load: {errorText(actors.error)}</ErrorNote>
          )
        ) : (
          <>
            <ActorGrid
              actors={(actors.data ?? []) as LibraryActor[]}
              filtered={gender !== undefined}
              deleting={remove.isPending ? remove.variables?.actorId : undefined}
              onDelete={
                workspace.status === "ready"
                  ? (actor) => {
                      if (window.confirm(`Delete ${actor.name} and their pictures? Renders already made stay.`))
                        remove.mutate({ workspaceId: workspace.workspaceId, actorId: actor.id });
                    }
                  : undefined
              }
            />
            {remove.error ? <ErrorNote>{errorText(remove.error)}</ErrorNote> : null}
          </>
        )}
      </Section>
    </>
  );
}
