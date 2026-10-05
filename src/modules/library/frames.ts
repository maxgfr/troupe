// Which pictures to take from a video: the opening, one after each cut,
// spread when there are more cuts than room, and a few across a video
// without cuts. Both editions use it (ffmpeg's scene detection on the
// server, frame differences in the page).

export function frameTimes(cuts: readonly number[], durationS: number | null, max: number): number[] {
  const opening = durationS && durationS < 1 ? durationS / 2 : 0.5;
  const after = cuts.filter((t) => t > opening + 0.5).map((t) => t + 0.2);
  // Spread over the cuts when there are more than room for.
  const room = Math.max(0, max - 1);
  const chosen = after.length <= room ? after : Array.from({ length: room }, (_, i) => after[Math.round((i * (after.length - 1)) / Math.max(1, room - 1))]!);
  // A video without cuts still gets a few pictures across its length.
  if (chosen.length === 0 && durationS && durationS > 4 && room > 0) {
    const n = Math.min(room, 3);
    for (let i = 1; i <= n; i++) chosen.push(Math.round(((durationS * i) / (n + 1)) * 10) / 10);
  }
  return [opening, ...chosen].map((t) => Math.round(t * 100) / 100);
}

// Cuts from the differences between frames sampled every `stepS` seconds
// (0 to 1, the mean change of a pixel): a change above `threshold`.
export function cutsFromDifferences(differences: readonly number[], stepS: number, threshold = 0.18): number[] {
  const cuts: number[] = [];
  differences.forEach((d, i) => {
    if (d > threshold) cuts.push(Math.round((i + 1) * stepS * 100) / 100);
  });
  return cuts;
}
