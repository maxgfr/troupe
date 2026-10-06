import { beforeEach, describe, expect, it } from "vitest";

import {
  clearFailures,
  clientAddress,
  GLOBAL_MAX_FAILURES,
  MAX_FAILURES,
  recordFailure,
  resetAttempts,
  retryAfterS,
} from "./attempts";

const headers = (init: Record<string, string>) => new Headers(init);

describe("clientAddress", () => {
  it("keys on the last X-Forwarded-For hop, which the client cannot choose, when no proxy is trusted", () => {
    expect(clientAddress(headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.9" }), 0)).toBe("203.0.113.9");
    // A forged first hop changes nothing.
    expect(clientAddress(headers({ "x-forwarded-for": "9.9.9.9, 203.0.113.9" }), 0)).toBe("203.0.113.9");
  });

  it("skips one hop per trusted proxy, counted from the right", () => {
    const h = headers({ "x-forwarded-for": "6.6.6.6, 198.51.100.7, 10.0.0.2" });
    expect(clientAddress(h, 1)).toBe("198.51.100.7");
    expect(clientAddress(h, 2)).toBe("6.6.6.6");
    // More trusted proxies than hops: the first hop is the best there is.
    expect(clientAddress(h, 5)).toBe("6.6.6.6");
  });

  it("falls back to X-Real-IP, then to one shared key", () => {
    expect(clientAddress(headers({ "x-real-ip": "198.51.100.8" }), 0)).toBe("198.51.100.8");
    expect(clientAddress(headers({}), 0)).toBe("local");
    expect(clientAddress(headers({ "x-forwarded-for": " , " }), 0)).toBe("local");
  });
});

describe("failed attempts", () => {
  beforeEach(() => resetAttempts());

  it("makes one address wait after too many wrong codes, until the window ends or a right one", () => {
    const now = 1_000_000;
    for (let i = 0; i < MAX_FAILURES; i++) recordFailure("a", now);
    expect(retryAfterS("a", now)).toBeGreaterThan(0);
    expect(retryAfterS("b", now)).toBe(0);
    expect(retryAfterS("a", now + 16 * 60 * 1000)).toBe(0);
    for (let i = 0; i < MAX_FAILURES; i++) recordFailure("a", now);
    clearFailures("a");
    expect(retryAfterS("a", now)).toBe(0);
  });

  it("stops everyone once wrong codes from many addresses reach the global ceiling", () => {
    const now = 2_000_000;
    // One wrong code from each of many addresses: none reaches its own limit.
    for (let i = 0; i < GLOBAL_MAX_FAILURES; i++) recordFailure(`10.0.${i >> 8}.${i & 255}`, now);
    expect(retryAfterS("someone-new", now)).toBeGreaterThan(0);
    // A right code for one address does not lift the ceiling for the others.
    clearFailures("10.0.0.1");
    expect(retryAfterS("someone-new", now)).toBeGreaterThan(0);
    expect(retryAfterS("someone-new", now + 16 * 60 * 1000)).toBe(0);
  });
});
