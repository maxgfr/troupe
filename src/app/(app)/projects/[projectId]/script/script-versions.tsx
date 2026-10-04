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
    <details className="rounded-xl border border-muted/20 px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium">Earlier versions ({older.length})</summary>
      <ul className="mt-3 space-y-2">
        {older.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="min-w-0 flex-1 truncate">
              <span className="font-mono text-xs text-muted">v{v.version} · ≈{v.estimatedDurationS}s · </span>
              {v.lines.map((l) => l.text).join(" ")}
            </span>
            <button type="button" disabled={busy} onClick={() => onRestore(v.id)} className="rounded-lg border border-muted/30 px-3 py-1 text-xs disabled:opacity-40">
              Restore v{v.version}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
