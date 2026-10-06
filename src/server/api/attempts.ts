import { env } from "~/env";

// Failed access-code attempts, in memory: after MAX_FAILURES wrong codes
// within WINDOW_MS, that client address must wait until the window ends; and
// after GLOBAL_MAX_FAILURES wrong codes from all addresses together, everyone
// must, so changing addresses does not buy more guesses. Signed-in browsers
// keep their cookie either way. A single studio process makes this enough to
// stop online guessing; a restart simply clears it.
export const MAX_FAILURES = 5;
export const GLOBAL_MAX_FAILURES = 100;
const WINDOW_MS = 15 * 60 * 1000;
type Window = { count: number; since: number };
const failures = new Map<string, Window>();
let global: Window | null = null;

// The client's address, from X-Forwarded-For read right to left: each proxy
// appends the address it was reached from, so only the hops your own proxies
// added can be trusted. TROUPE_TRUSTED_PROXIES (default 0) is how many of them
// sit behind the one that faces the internet; with 0 the key is the last hop,
// what the nearest proxy (or Vercel) saw. Without a proxy every header is the
// client's to choose, which the global ceiling covers.
export function clientAddress(headers: Headers, trustedProxies = env.TROUPE_TRUSTED_PROXIES ?? 0): string {
  const hops = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  if (hops.length) return hops[Math.max(0, hops.length - 1 - trustedProxies)]!;
  return headers.get("x-real-ip")?.trim() || "local";
}

const waitS = (entry: Window | null | undefined, limit: number, now: number) =>
  entry && now - entry.since <= WINDOW_MS && entry.count >= limit
    ? Math.ceil((entry.since + WINDOW_MS - now) / 1000)
    : 0;

// Seconds to wait before trying again, or 0.
export function retryAfterS(address: string, now = Date.now()): number {
  const entry = failures.get(address);
  if (entry && now - entry.since > WINDOW_MS) failures.delete(address);
  return Math.max(waitS(global, GLOBAL_MAX_FAILURES, now), waitS(failures.get(address), MAX_FAILURES, now));
}

export function recordFailure(address: string, now = Date.now()) {
  const entry = failures.get(address);
  if (!entry || now - entry.since > WINDOW_MS) failures.set(address, { count: 1, since: now });
  else entry.count++;
  if (!global || now - global.since > WINDOW_MS) global = { count: 1, since: now };
  else global.count++;
  // Keep memory bounded if many addresses try.
  if (failures.size > 10_000) failures.delete(failures.keys().next().value!);
}

// A right code clears that address's count, not the global one.
export function clearFailures(address: string) {
  failures.delete(address);
}

// For tests.
export function resetAttempts() {
  failures.clear();
  global = null;
}
