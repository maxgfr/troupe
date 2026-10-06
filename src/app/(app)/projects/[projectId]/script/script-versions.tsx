import { ChevronRightIcon } from "~/app/_components/icons";
import { Button } from "~/app/_components/ui";

export interface ScriptVersionView {
  id: string;
  version: number;
  estimatedDurationS: number;
  createdAt?: string | Date;
  lines: { text: string }[];
}

// Pure view — earlier versions, newest first, each restorable.
export function ScriptVersions({ versions, currentId, busy, onRestore }: {
  versions: ScriptVersionView[];
  currentId: string | null;
  busy?: boolean;
  onRestore: (scriptId: string) => void;
}) {
  const older = versions.filter((v) => v.id !== currentId).sort((a, b) => b.version - a.version);
  if (older.length === 0) return null;
  return (
    <details className="group rounded-2xl bg-surface/60 px-4 py-3 sm:px-5">
      <summary className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md text-sm font-medium marker:content-none">
        <ChevronRightIcon className="size-4 text-muted transition-transform duration-150 group-open:rotate-90" />
        Earlier versions <span className="font-mono text-xs font-normal tabular-nums text-muted">{older.length}</span>
      </summary>
      <ul className="mt-2 divide-y divide-line">
        {older.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
            <span className="min-w-0 flex-1 truncate">
              <span className="font-mono text-xs text-muted">v{v.version} · ≈{v.estimatedDurationS}s · </span>
              {v.lines.map((l) => l.text).join(" ")}
            </span>
            <Button size="sm" disabled={busy} onClick={() => onRestore(v.id)}>
              Restore v{v.version}
            </Button>
          </li>
        ))}
      </ul>
    </details>
  );
}
