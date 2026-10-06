import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "~/test/db";
import { resolveCatalog } from "./resolve";
import {
  archiveLocalModel,
  createLocalModel,
  getDefaultModelKey,
  listModelConfigs,
  setDefaultModelKey,
  updateLocalModel,
  updateModelPreferences,
} from "./service";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.pg.close();
});

const caps = {
  aspectRatios: ["16:9"],
  resolutions: ["480p"],
  durationsS: [5],
  audio: "none" as const,
  dialogueLanguages: null,
};
const credentials = { google: "saved", fal: "none" } as const;

describe("model catalog persistence", () => {
  it("stores built-in preferences on first change and reads them back resolved", async () => {
    await updateModelPreferences(t.db, "veo-3.1-fast", { enabled: false, pricePerSecondUsd: 0.15 });
    await updateModelPreferences(t.db, "veo-3.1-fast", { timeoutS: 600 });
    const [veo] = resolveCatalog({ rows: await listModelConfigs(t.db), credentials });
    expect(veo).toMatchObject({ key: "veo-3.1-fast", enabled: false, pricePerSecondUsd: 0.15, timeoutS: 600 });
  });

  it("creates, edits and archives a local model without touching built-ins", async () => {
    const key = await createLocalModel(t.db, {
      family: "http",
      label: "My GPU box",
      capabilities: caps,
      connection: { baseUrl: "http://gpu.lan:8000" },
    });
    expect(key).toMatch(/^local-my-gpu-box-[0-9a-f]{6}$/);
    await updateLocalModel(t.db, key, { label: "GPU box" });
    await archiveLocalModel(t.db, key);
    const local = resolveCatalog({ rows: await listModelConfigs(t.db), credentials }).find((m) => m.key === key)!;
    expect(local).toMatchObject({ label: "GPU box", archived: true, kind: "local", status: "ready" });
    await expect(archiveLocalModel(t.db, "veo-3.1-fast")).rejects.toThrow(/not found/);
    await expect(updateModelPreferences(t.db, "local-missing", { enabled: false })).rejects.toThrow(/not found/);
  });

  it("remembers the studio default", async () => {
    expect(await getDefaultModelKey(t.db)).toBeNull();
    await setDefaultModelKey(t.db, "kling-3.0");
    await setDefaultModelKey(t.db, "seedance-1.5-pro");
    expect(await getDefaultModelKey(t.db)).toBe("seedance-1.5-pro");
  });
});
