import { ActorPortrait } from "~/app/_components/actor-portrait";
import { EmptyState } from "~/app/_components/ui";
import { POSTER_SIZES } from "../dashboard/dashboard-view";

export interface LibraryActor {
  id: string;
  workspaceId: string | null;
  name: string;
  gender: string;
  ageRange: string;
  style: string;
  voiceProfile: string;
  status: "active" | "unavailable";
  // The front portrait; null shows the initials.
  portraitUrl?: string | null;
}

// Pure view — the 30-actor grid: each actor as a portrait card, the name on
// the picture, the voice and style below.
export function ActorGrid({ actors, filtered = false }: { actors: LibraryActor[]; filtered?: boolean }) {
  if (actors.length === 0) {
    return filtered ? (
      <EmptyState title="No actor matches this filter" body="Choose All or another filter to see more actor presets." />
    ) : (
      <EmptyState
        title="The actor library is empty"
        body="Troupe adds its 30 actor presets when the studio opens. Reload in a moment; if the library stays empty, check that the database is running."
      />
    );
  }
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-6">
      {actors.map((actor, i) => (
        <li key={actor.id} className={`group ${actor.status === "unavailable" ? "opacity-50" : ""}`}>
          <div className="relative overflow-hidden rounded-xl shadow-card">
            <ActorPortrait
              id={actor.id}
              name={actor.name}
              src={actor.portraitUrl}
              label={`${actor.name} — ${actor.style}, ${actor.ageRange}, ${actor.voiceProfile} voice`}
              sizes={POSTER_SIZES}
              priority={i < 4}
              className="aspect-[4/5] w-full transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-xl shadow-[inset_0_0_0_1px_var(--picture-edge)]"
            />
            <span
              aria-hidden
              className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-3 pt-10 pb-2.5 font-display text-lg font-semibold tracking-[-0.01em] text-white"
            >
              {actor.name}
            </span>
          </div>
          <p className="mt-2.5 text-pretty text-xs text-muted">
            <span className="sr-only">{actor.name}: </span>
            <span className="capitalize">{actor.gender}</span> ·{" "}
            <span className="font-mono tabular-nums">{actor.ageRange}</span> · {actor.style}
            <span className="block text-fg/80">Voice {actor.voiceProfile}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}
