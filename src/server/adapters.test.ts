import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createTestDb } from "~/test/db";
import { updateModelPreferences } from "~/modules/models";
import { resetSecretBoxCache } from "~/server/settings/secrets";
import { loadModelCatalog } from "./adapters";

beforeEach(() => {
  vi.stubEnv("TROUPE_SECRET", "catalog-test");
  vi.stubEnv("GOOGLE_GENAI_API_KEY", "");
  vi.stubEnv("FAL_KEY", "");
  resetSecretBoxCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetSecretBoxCache();
});

describe("model catalog loading", () => {
  it("builds adapters only for models whose account is configured", async () => {
    const t = await createTestDb();
    try {
      vi.stubEnv("GOOGLE_GENAI_API_KEY", "test-key");
      const catalog = await loadModelCatalog(t.db);
      expect([...catalog.adapters.keys()]).toEqual(["veo-3.1-fast", "veo-3.1-lite"]);
      expect(catalog.defaultModelKey).toBe("veo-3.1-fast");
      expect(catalog.models.find((m) => m.key === "kling-3.0")?.status).toBe("missing-credentials");
    } finally { await t.pg.close(); }
  });

  it("keeps a disabled model's adapter so its running jobs still finish, but never defaults to it", async () => {
    const t = await createTestDb();
    try {
      vi.stubEnv("FAL_KEY", "fal-key");
      await updateModelPreferences(t.db, "kling-3.0", { enabled: false });
      const catalog = await loadModelCatalog(t.db);
      expect(catalog.adapters.has("kling-3.0")).toBe(true);
      expect(catalog.models.find((m) => m.key === "kling-3.0")?.enabled).toBe(false);
      expect(catalog.defaultModelKey).toBe("seedance-1.5-pro");
    } finally { await t.pg.close(); }
  });
});
