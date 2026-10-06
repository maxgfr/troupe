import type { DraftLine } from "~/modules/script";

// Pure and type-only imports: the project page imports this file directly.

export type LineChange =
  | { kind: "same"; line: DraftLine }
  | { kind: "changed"; before: DraftLine; after: DraftLine }
  | { kind: "added"; line: DraftLine }
  | { kind: "removed"; line: DraftLine };

const sameText = (a: DraftLine, b: DraftLine) => a.text.trim() === b.text.trim();
const sameLine = (a: DraftLine, b: DraftLine) => sameText(a, b) && a.role === b.role && a.emotion === b.emotion;

// The proposed lines against the current version, in reading order. Lines
// are matched on their text (longest common subsequence); a removed line
// followed by an added one reads as that line rewritten.
export function diffLines(current: readonly DraftLine[], proposed: readonly DraftLine[]): LineChange[] {
  const n = current.length;
  const m = proposed.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = sameText(current[i]!, proposed[j]!)
        ? lcs[i + 1]![j + 1]! + 1
        : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const raw: LineChange[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && sameText(current[i]!, proposed[j]!)) {
      raw.push(
        sameLine(current[i]!, proposed[j]!)
          ? { kind: "same", line: proposed[j]! }
          : { kind: "changed", before: current[i]!, after: proposed[j]! },
      );
      i++;
      j++;
    } else if (i < n && (j >= m || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) {
      // Removals first, so a rewrite reads as a removal then its addition.
      raw.push({ kind: "removed", line: current[i++]! });
    } else {
      raw.push({ kind: "added", line: proposed[j++]! });
    }
  }
  // Pair each run of removals with the additions right after it.
  const out: LineChange[] = [];
  for (let k = 0; k < raw.length; ) {
    const removed: DraftLine[] = [];
    while (raw[k]?.kind === "removed") removed.push((raw[k++] as { line: DraftLine }).line);
    const added: DraftLine[] = [];
    while (raw[k]?.kind === "added") added.push((raw[k++] as { line: DraftLine }).line);
    if (removed.length === 0 && added.length === 0) {
      out.push(raw[k++]!);
      continue;
    }
    const pairs = Math.min(removed.length, added.length);
    for (let p = 0; p < pairs; p++) out.push({ kind: "changed", before: removed[p]!, after: added[p]! });
    for (const line of removed.slice(pairs)) out.push({ kind: "removed", line });
    for (const line of added.slice(pairs)) out.push({ kind: "added", line });
  }
  return out;
}
