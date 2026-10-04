// Tie-aware vote tally. Pure and import-free on purpose: the
// server list summary and the client Benchmark Lab share this exact logic —
// a tie must read the same on both sides, and the client bundle must not pull
// server schema through the module barrel.
export interface VotedEntry {
  id: string;
  modelKey: string;
  votes?: Record<string, number>;
}

export function tallyWinner(entries: readonly VotedEntry[]): { winnerId: string | null; tie: boolean } {
  let best = 0;
  let winnerId: string | null = null;
  let tie = false;
  for (const entry of entries) {
    const score = Object.values(entry.votes ?? {}).reduce((a, b) => a + b, 0);
    if (score === 0) continue;
    if (score > best) {
      best = score;
      winnerId = entry.id;
      tie = false;
    } else if (score === best) {
      tie = true;
      winnerId = null;
    }
  }
  return { winnerId, tie };
}
