import Link from "next/link";

import { useEdition } from "~/app/_components/edition";
import { EmptyState, StatusChip } from "~/app/_components/ui";

export interface DashboardProject {
  id: string;
  title: string;
  platform: string | null;
  format: string | null;
  status: string;
  createdAt?: string | Date;
}

// Pure view — testable without tRPC (screens.test.tsx).
export function DashboardView({ projects }: { projects: DashboardProject[] }) {
  const demo = useEdition().kind === "demo";
  if (projects.length === 0) {
    return (
      <EmptyState
        title="Create your first project"
        body={
          demo
            ? "Pick a platform, format, language and actor, then write a short script. Everything you make here is saved in this browser."
            : "Pick a platform, format, language and actor, then write a short script. Add an API key or a local model in Settings when you are ready to render."
        }
        cta={{ label: "New project", href: "/projects/new" }}
      />
    );
  }
  return (
    <ul className="divide-y divide-muted/15 rounded-xl border border-muted/20">
      {projects.map((p) => (
        <li key={p.id}>
          <Link
            href={`/projects/${p.id}`}
            className="flex items-center justify-between gap-4 px-4 py-3 transition-colors duration-150 hover:bg-surface"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{p.title}</p>
              <p className="mt-0.5 font-mono text-xs text-muted">
                {p.platform ?? "platform —"} · {p.format ?? "format —"}{p.createdAt ? ` · ${new Date(p.createdAt).toLocaleDateString()}` : ""}
              </p>
            </div>
            <StatusChip status={p.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

