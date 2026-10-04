"use client";

import { ActorGrid, type LibraryActor } from "./actor-grid";
import { useState } from "react";

import { api } from "~/trpc/react";
import {
  ErrorNote,
  PageHeader,
  Section,
  SignedOutNotice,
  Skeleton,
} from "~/app/_components/ui";

const GENDERS = ["female", "male", "nonbinary"] as const;

export default function ActorsPage() {
  const [gender, setGender] = useState<string | undefined>();
  const actors = api.actors.list.useQuery(gender ? { gender } : undefined, { retry: false });

  return (
    <>
      <PageHeader
        title="Actor presets"
        lede="Choose a voice and appearance profile for your script. These are text presets; faces can vary between generations."
      />

      <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Filter by gender">
        <button
          type="button"
          onClick={() => setGender(undefined)}
          aria-pressed={gender === undefined}
          className={`rounded-lg border px-3 py-1.5 text-sm transition-colors duration-150 ${
            gender === undefined
              ? "border-primary bg-primary/15 font-medium text-primary"
              : "border-muted/40 text-muted hover:text-fg"
          }`}
        >
          All
        </button>
        {GENDERS.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGender(g)}
            aria-pressed={gender === g}
            className={`rounded-lg border px-3 py-1.5 text-sm capitalize transition-colors duration-150 ${
              gender === g
                ? "border-primary bg-primary/15 font-medium text-primary"
                : "border-muted/40 text-muted hover:text-fg"
            }`}
          >
            {g}
          </button>
        ))}
      </div>

      <Section>
        {actors.isPending ? (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="aspect-[4/3] w-full" />
            ))}
          </div>
        ) : actors.error ? (
          actors.error.data?.code === "UNAUTHORIZED" ? (
            <SignedOutNotice />
          ) : (
            <ErrorNote>The library failed to load: {actors.error.message}</ErrorNote>
          )
        ) : (
          <ActorGrid actors={(actors.data ?? []) as LibraryActor[]} />
        )}
      </Section>

    </>
  );
}
