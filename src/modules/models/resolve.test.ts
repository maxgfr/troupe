import { describe, expect, it } from "vitest";

import { effectiveDefaultModel, estimateCostUsd, resolveCatalog, type ModelConfigRow } from "./resolve";

const none = { google: "none", fal: "none" } as const;
const row = (patch: Partial<ModelConfigRow>): ModelConfigRow => ({
  id: "x", family: "veo", label: null, enabled: true, archived: false, defaults: null,
  pricePerSecondUsd: null, timeoutS: null, capabilities: null, connection: null,
  secretCiphertext: null, secretFingerprint: null, createdAt: new Date("2026-01-01"), ...patch,
});
const localCaps = { aspectRatios: ["16:9"], resolutions: ["480p"], durationsS: [5], audio: "none" as const, dialogueLanguages: null };

describe("resolveCatalog", () => {
  it("lists the built-in cloud models with a status derived from their credentials", () => {
    const models = resolveCatalog({ rows: [], credentials: { google: "saved", fal: "undecryptable" } });
    expect(models.map((m) => [m.key, m.status])).toEqual([
      ["veo-3.1-fast", "ready"],
      ["kling-3.0", "undecryptable"],
      ["seedance-1.5-pro", "undecryptable"],
    ]);
    expect(resolveCatalog({ rows: [], credentials: none }).every((m) => m.status === "missing-credentials")).toBe(true);
  });

  it("applies saved overrides and drops defaults the model cannot honour", () => {
    const [veo] = resolveCatalog({
      rows: [row({ id: "veo-3.1-fast", enabled: false, pricePerSecondUsd: "0.15", timeoutS: 900, defaults: { resolution: "1080p", durationS: 6, audio: true } })],
      credentials: none,
    });
    expect(veo).toMatchObject({ enabled: false, pricePerSecondUsd: 0.15, timeoutS: 900, defaults: { resolution: "720p", durationS: 6, audio: true } });
  });

  it("appends local models after the built-ins, oldest first, with their own capabilities", () => {
    const models = resolveCatalog({
      rows: [
        row({ id: "local-b", family: "http", label: "B", capabilities: localCaps, createdAt: new Date("2026-03-01") }),
        row({ id: "local-a", family: "comfyui", label: "A", capabilities: localCaps, createdAt: new Date("2026-02-01") }),
        row({ id: "local-c", family: "http", label: "Broken" }),
      ],
      credentials: none,
      checkLocal: (r) => (r.id === "local-b" ? { status: "unsupported-host", detail: "metadata address" } : null),
    });
    const locals = models.filter((m) => m.kind === "local");
    expect(locals.map((m) => [m.key, m.status])).toEqual([["local-c", "invalid"], ["local-a", "ready"], ["local-b", "unsupported-host"]]);
    expect(locals.find((m) => m.key === "local-a")).toMatchObject({ pricePerSecondUsd: 0, defaults: { resolution: "480p", durationS: 5, audio: false } });
  });
});

describe("effectiveDefaultModel", () => {
  const models = resolveCatalog({ rows: [row({ id: "veo-3.1-fast", enabled: false })], credentials: { google: "saved", fal: "saved" } });

  it("keeps the saved default when it can launch", () => {
    expect(effectiveDefaultModel(models, "seedance-1.5-pro")).toBe("seedance-1.5-pro");
  });

  it("falls back to the first launchable model otherwise", () => {
    expect(effectiveDefaultModel(models, "veo-3.1-fast")).toBe("kling-3.0");
    expect(effectiveDefaultModel(models, null)).toBe("kling-3.0");
    expect(effectiveDefaultModel(resolveCatalog({ rows: [], credentials: none }), null)).toBeNull();
  });
});

describe("estimateCostUsd", () => {
  it("multiplies the per-second price, is free locally and unknown without a price", () => {
    expect(estimateCostUsd({ kind: "cloud", pricePerSecondUsd: 0.15 }, 8)).toBe(1.2);
    expect(estimateCostUsd({ kind: "local", pricePerSecondUsd: null }, 8)).toBe(0);
    expect(estimateCostUsd({ kind: "cloud", pricePerSecondUsd: null }, 8)).toBeNull();
  });
});
