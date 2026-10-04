import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, migrateTestDb, setAuthUser } from "~/test/db";
import { clearProviderKey, credentialStatus, effectiveProviderKeys, readCredentials, saveProviderKey } from "./providers";
import { resetSecretBoxCache } from "./secrets";

beforeEach(() => {
  vi.stubEnv("TROUPE_SECRET", "test-secret-one");
  vi.stubEnv("GOOGLE_GENAI_API_KEY", "");
  vi.stubEnv("FAL_KEY", "");
  resetSecretBoxCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetSecretBoxCache();
});

describe("private provider settings", () => {
  it("stores keys encrypted, reports only configuration state and can disable an environment key", async () => {
    const t = await createTestDb();
    try {
      vi.stubEnv("GOOGLE_GENAI_API_KEY", "environment-fixture");
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      await saveProviderKey({ provider: "fal", key: "fal-fixture" }, t.db);
      const raw = (await t.pg.query<{ apiKey: string | null; apiKeyCiphertext: string }>("select * from troupe_provider_settings")).rows[0]!;
      expect(raw.apiKey).toBeNull();
      expect(raw.apiKeyCiphertext).not.toContain("fal-fixture");
      expect(await credentialStatus(t.db)).toEqual({
        google: { configured: true, source: "environment" },
        fal: { configured: true, source: "saved" },
        anthropic: { configured: false, source: "none" },
      });
      await clearProviderKey({ provider: "google", mode: "disable" }, t.db);
      expect(await effectiveProviderKeys(t.db)).toEqual({ fal: "fal-fixture" });
      await clearProviderKey({ provider: "google", mode: "remove" }, t.db);
      expect(await effectiveProviderKeys(t.db)).toEqual({ google: "environment-fixture", fal: "fal-fixture" });
      await setAuthUser(t, "00000000-0000-4000-8000-000000000001");
      expect((await t.pg.query("select * from troupe_provider_settings")).rows).toEqual([]);
    } finally { await t.pg.close(); }
  });

  it("migrates a plaintext key from an older install on first read", async () => {
    const t = await createTestDb({ until: "0014" });
    try {
      await t.pg.exec(`insert into troupe_provider_settings (provider, "apiKey") values ('google', 'legacy-google'), ('fal', '')`);
      await migrateTestDb(t);
      expect(await effectiveProviderKeys(t.db)).toEqual({ google: "legacy-google" });
      const rows = (await t.pg.query<{ provider: string; apiKey: string | null; apiKeyCiphertext: string | null }>(`select * from troupe_provider_settings order by provider`)).rows;
      expect(rows.map((r) => [r.provider, r.apiKey, r.apiKeyCiphertext === null])).toEqual([["fal", null, true], ["google", null, false]]);
      expect((await readCredentials(t.db)).fal.source).toBe("disabled");
    } finally { await t.pg.close(); }
  });

  it("asks for the key again instead of crashing when the secret changed", async () => {
    const t = await createTestDb();
    try {
      await saveProviderKey({ provider: "google", key: "sealed-with-one" }, t.db);
      vi.stubEnv("TROUPE_SECRET", "test-secret-two");
      resetSecretBoxCache();
      expect(await credentialStatus(t.db)).toMatchObject({ google: { configured: false, source: "undecryptable" } });
      await saveProviderKey({ provider: "google", key: "re-entered" }, t.db);
      expect(await effectiveProviderKeys(t.db)).toEqual({ google: "re-entered" });
    } finally { await t.pg.close(); }
  });
});
