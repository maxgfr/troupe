import { CliError } from "./errors.ts";

// Find one item from what a person typed: its full id, its name or title
// (any case), or the start of its id (at least 4 characters, as the tables
// show 8).
export function pick<T>(
  items: readonly T[],
  ref: string,
  opts: {
    kind: string;
    listCommand: string;
    id: (item: T) => string;
    names?: (item: T) => (string | null | undefined)[];
  },
): T {
  const wanted = ref.trim().toLowerCase();
  const byId = items.find((item) => opts.id(item).toLowerCase() === wanted);
  if (byId) return byId;
  const byName = items.filter((item) =>
    (opts.names?.(item) ?? []).some((name) => name?.trim().toLowerCase() === wanted),
  );
  if (byName.length === 1) return byName[0]!;
  const byPrefix = wanted.length >= 4 ? items.filter((item) => opts.id(item).toLowerCase().startsWith(wanted)) : [];
  const found = byName.length > 1 ? byName : byPrefix;
  if (found.length === 1) return found[0]!;
  if (found.length > 1) {
    throw new CliError(
      `"${ref}" matches ${found.length} ${opts.kind}s (${found
        .slice(0, 5)
        .map((item) => opts.id(item).slice(0, 8))
        .join(", ")}). Use more of the id.`,
      { code: "AMBIGUOUS" },
    );
  }
  throw new CliError(`No ${opts.kind} matches "${ref}". List them with ${opts.listCommand}.`, { code: "NOT_FOUND" });
}
