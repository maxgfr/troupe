import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, migrateTestDb, type TestDb } from "~/test/db";

let t: TestDb;
const WS = "11111111-1111-4111-8111-000000000001";
const PROJECT = "11111111-1111-4111-8111-000000000002";
const KLING = "11111111-1111-4111-8111-000000000003";
const SORA = "11111111-1111-4111-8111-000000000004";

beforeAll(async () => {
  t = await createTestDb({ until: "0015" });
  await t.pg.exec(`
    insert into troupe_workspace (id, name, "ownerId") values ('${WS}', 'Legacy', '${WS}');
    insert into troupe_project (id, "workspaceId", title, format, platform, language, "providerId")
      values ('${PROJECT}', '${WS}', 'Old', '9:16', 'tiktok', 'en', 'kling');
    insert into troupe_generation (id, "projectId", provider, "modelId", "inputMode", tier, prompt, "aspectRatio", "durationS", resolution, status, "providerJobId", "costUsd")
      values ('${KLING}', '${PROJECT}', 'kling', 'kling-3.0', 'text', 'final', 'p', '9:16', 8, '720p', 'in_progress', 'job-1', null),
             ('${SORA}', '${PROJECT}', 'sora2', 'sora-2', 'text', 'final', 'p', '9:16', 8, '720p', 'completed', 'job-2', 1.5);
    insert into troupe_generation_watch ("generationId", provider, "providerJobId", "nextPollAt", "createdAt")
      values ('${KLING}', 'kling', 'job-1', now(), '2026-01-01T10:00:00Z');
  `);
  await migrateTestDb(t);
});
afterAll(async () => { await t.pg.close(); });

describe("model catalog migration", () => {
  it("backfills catalog keys from the legacy provider columns", async () => {
    const project = (await t.pg.query<{ modelKey: string }>(`select "modelKey" from troupe_project where id = '${PROJECT}'`)).rows[0]!;
    expect(project.modelKey).toBe("kling-3.0");
    const gens = (await t.pg.query<{ id: string; modelKey: string; costSource: string | null }>(`select id, "modelKey", "costSource" from troupe_generation order by id`)).rows;
    expect(gens).toEqual([
      { id: KLING, modelKey: "kling-3.0", costSource: null },
      { id: SORA, modelKey: "legacy-sora2", costSource: "provider" },
    ]);
  });

  it("keeps an in-flight job on the 30-minute deadline it was submitted under", async () => {
    const watch = (await t.pg.query<{ modelKey: string; deadlineAt: Date }>(`select "modelKey", "deadlineAt" from troupe_generation_watch`)).rows[0]!;
    expect(watch.modelKey).toBe("kling-3.0");
    expect(new Date(watch.deadlineAt).toISOString()).toBe("2026-01-01T10:30:00.000Z");
  });
});
