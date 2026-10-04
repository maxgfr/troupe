import { ActorPortrait } from "~/app/_components/actor-portrait";
import { EmptyState } from "~/app/_components/ui";

export interface LibraryActor {
  id: string;
  workspaceId: string | null;
  name: string;
  gender: string;
  ageRange: string;
  style: string;
  voiceProfile: string;
  status: "active" | "unavailable";
}

// Pure view — the 30-actor grid.
export function ActorGrid({ actors }: { actors: LibraryActor[] }) {
  if (actors.length === 0) {
    return (
      <EmptyState
        title="No actor matches these filters"
        body="Choose another filter to see more actor presets."
      />
    );
  }
  return (
    <ul className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
      {actors.map((actor) => (
        <li
          key={actor.id}
          className={`overflow-hidden rounded-xl border border-muted/25 transition-colors duration-150 hover:border-primary ${
            actor.status === "unavailable" ? "opacity-50" : ""
          }`}
        >
          <ActorPortrait
            id={actor.id}
            name={actor.name}
            label={`${actor.name} — ${actor.style}, ${actor.ageRange}, ${actor.voiceProfile} voice`}
            className="aspect-[4/3] w-full"
          />
          <div className="px-4 py-3">
            <p className="font-medium">{actor.name}</p>
            <p className="mt-0.5 text-xs text-muted">
              {actor.gender} · {actor.ageRange} · {actor.style} · voice {actor.voiceProfile}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

