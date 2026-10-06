import { describe, expect, it } from "vitest";

import { listPriceUsd } from "./list-price";

// What a clip costs at the providers' list prices of 2026-10-05, for the
// settings actually sent: the live checks quote these before spending.
describe("listPriceUsd", () => {
  it("prices each built-in for its resolution and audio", () => {
    expect(
      listPriceUsd(
        { key: "veo-3.1-lite", kind: "cloud", pricePerSecondUsd: 0.05 },
        { durationS: 4, resolution: "720p", audio: true },
      ),
    ).toBe(0.2);
    expect(
      listPriceUsd(
        { key: "veo-3.1-fast", kind: "cloud", pricePerSecondUsd: 0.1 },
        { durationS: 8, resolution: "1080p", audio: true },
      ),
    ).toBe(0.96);
    // Kling bills less without audio than the catalog's with-audio price.
    expect(
      listPriceUsd(
        { key: "kling-3.0", kind: "cloud", pricePerSecondUsd: 0.126 },
        { durationS: 3, resolution: "720p", audio: false },
      ),
    ).toBe(0.25);
    expect(
      listPriceUsd(
        { key: "kling-3.0", kind: "cloud", pricePerSecondUsd: 0.126 },
        { durationS: 3, resolution: "720p", audio: true },
      ),
    ).toBe(0.38);
    // Seedance bills video tokens: 480p silent is a few cents.
    expect(
      listPriceUsd(
        { key: "seedance-1.5-pro", kind: "cloud", pricePerSecondUsd: 0.052 },
        { durationS: 4, resolution: "480p", audio: false },
      ),
    ).toBe(0.05);
    expect(
      listPriceUsd(
        { key: "seedance-1.5-pro", kind: "cloud", pricePerSecondUsd: 0.052 },
        { durationS: 5, resolution: "720p", audio: true },
      ),
    ).toBe(0.26);
  });

  it("falls back to the catalog price, is free locally and unknown without a price", () => {
    expect(
      listPriceUsd(
        { key: "other", kind: "cloud", pricePerSecondUsd: 0.2 },
        { durationS: 5, resolution: "720p", audio: true },
      ),
    ).toBe(1);
    expect(
      listPriceUsd(
        { key: "other", kind: "cloud", pricePerSecondUsd: null },
        { durationS: 5, resolution: "720p", audio: true },
      ),
    ).toBeNull();
    expect(
      listPriceUsd(
        { key: "local-x", kind: "local", pricePerSecondUsd: null },
        { durationS: 5, resolution: "480p", audio: false },
      ),
    ).toBe(0);
  });
});
