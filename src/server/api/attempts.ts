// Failed access-code attempts per client address, in memory: after
// MAX_FAILURES wrong codes within WINDOW_MS, that address must wait until the
// window ends. A single studio process makes this enough to stop online
// guessing; a restart simply clears it.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; since: number }>();

export function clientAddress(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "local";
}

// Seconds to wait before trying again, or 0.
export function retryAfterS(address: string, now = Date.now()): number {
  const entry = failures.get(address);
  if (!entry) return 0;
  if (now - entry.since > WINDOW_MS) {
    failures.delete(address);
    return 0;
  }
  return entry.count >= MAX_FAILURES ? Math.ceil((entry.since + WINDOW_MS - now) / 1000) : 0;
}

export function recordFailure(address: string, now = Date.now()) {
  const entry = failures.get(address);
  if (!entry || now - entry.since > WINDOW_MS) failures.set(address, { count: 1, since: now });
  else entry.count++;
  // Keep memory bounded if many addresses try.
  if (failures.size > 10_000) failures.delete(failures.keys().next().value!);
}

export function clearFailures(address: string) {
  failures.delete(address);
}
