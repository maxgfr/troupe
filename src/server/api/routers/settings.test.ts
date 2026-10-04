import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "~/test/db";
import { testCaller } from "~/test/caller";
import { catalogOf, fakeAdapter } from "~/test/adapters";
import { getDefaultModelKey, listModelConfigs } from "~/modules/models";
import { resetSecretBoxCache } from "~/server/settings/secrets";

const USER = "c1111111-1111-4111-8111-111111111111";
let t: TestDb;

beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t.pg.close(); });
beforeEach(() => {
  vi.stubEnv("TROUPE_SECRET", "settings-test");
  vi.stubEnv("GOOGLE_GENAI_API_KEY", "");
  vi.stubEnv("FAL_KEY", "");
  resetSecretBoxCache();
});
afterEach(() => { vi.unstubAllEnvs(); resetSecretBoxCache(); });

const veo = { ...fakeAdapter({ modelKey: "veo-3.1-fast", capabilities: { resolutions: ["720p"], durationsS: [4, 6, 8] } }), testConnection: async () => ({ ok: true, message: "The key can reach veo." }) };
const kling = fakeAdapter({ modelKey: "kling-3.0" });

describe("settings router", () => {
  it("saves, reports and clears provider keys without ever returning them", async () => {
    const caller = testCaller({ db: t.db, userId: USER });
    const saved = await caller.settings.credentials.save({ provider: "fal", key: "fal-secret" });
    expect(saved.fal).toEqual({ configured: true, source: "saved" });
    expect(JSON.stringify(saved)).not.toContain("fal-secret");
    expect((await caller.settings.credentials.clear({ provider: "fal", mode: "remove" })).fal.configured).toBe(false);
    await expect(caller.settings.credentials.save({ provider: "fal", key: "  " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("tests a Google key by reading the model and says fal cannot be checked for free", async () => {
    const caller = testCaller({ db: t.db, userId: USER, catalog: catalogOf([veo, kling]) });
    expect(await caller.settings.credentials.test({ provider: "google" })).toMatchObject({ ok: true });
    expect(await caller.settings.credentials.test({ provider: "fal" })).toMatchObject({ ok: null });
    expect(await testCaller({ db: t.db, userId: USER }).settings.credentials.test({ provider: "google" })).toMatchObject({ ok: false });
  });

  it("stores model preferences, keeping only defaults the model can honour", async () => {
    const caller = testCaller({ db: t.db, userId: USER, catalog: catalogOf([veo, kling]) });
    await caller.settings.models.update({ modelKey: "veo-3.1-fast", enabled: false, pricePerSecondUsd: 0.15, timeoutS: 900, defaults: { resolution: "1080p", durationS: 6, audio: true } });
    const row = (await listModelConfigs(t.db)).find((r) => r.id === "veo-3.1-fast")!;
    expect(row).toMatchObject({ enabled: false, pricePerSecondUsd: "0.15", timeoutS: 900, defaults: { resolution: "720p", durationS: 6, audio: true } });
    await expect(caller.settings.models.update({ modelKey: "veo-3.1-fast", timeoutS: 5 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("only accepts a default model that can launch", async () => {
    const caller = testCaller({ db: t.db, userId: USER, catalog: catalogOf([veo, kling], { patch: { "veo-3.1-fast": { enabled: false, label: "Veo" } } }) });
    await expect(caller.settings.models.setDefault({ modelKey: "veo-3.1-fast" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await caller.settings.models.setDefault({ modelKey: "kling-3.0" });
    expect(await getDefaultModelKey(t.db)).toBe("kling-3.0");
    await caller.settings.models.setDefault({ modelKey: null });
    expect(await getDefaultModelKey(t.db)).toBeNull();
  });
});
