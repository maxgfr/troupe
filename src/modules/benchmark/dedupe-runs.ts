// Merging the bounded first page with on-demand older pages
// can surface the same run twice once react-query refetches the first page.
// Dedup by id, keeping the first (newest, authoritative) occurrence and order.
export function dedupeRunsById<T extends { id: string }>(runs: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const run of runs) {
    if (seen.has(run.id)) continue;
    seen.add(run.id);
    out.push(run);
  }
  return out;
}
