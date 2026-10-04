import { beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "~/test/db";
import { createWorkspace } from "~/modules/identity";
import { projects } from "~/modules/studio/server/schema";
import { seedActorLibrary, listActors, attachActorToProject } from "~/modules/actors";
import { pasteScript } from "~/modules/script";
import { fakeAdapter, finishGeneration } from "~/test/adapters";
import { ingestRender, launchGeneration } from "~/modules/generation";
import { checkExportSpecs, createExport } from "~/modules/export";

const USER = "e1111111-1111-4111-8111-111111111111";

let t: TestDb;
let ws: string;
let genId: string;

beforeAll(async () => {
  t = await createTestDb();
  ws = (await createWorkspace(t.db, { userId: USER, name: "Export" })).id;
  await seedActorLibrary(t.db);
  const actor = (await listActors(t.db, {}))[0]!;
  const [p] = await t.db.insert(projects).values({ workspaceId: ws, title: "Exportable", format: "9:16", platform: "tiktok", language: "en" }).returning();
  await attachActorToProject(t.db, { projectId: p!.id, actorId: actor.id });
  const scriptId = (await pasteScript(t.db, { projectId: p!.id, text: "Export me." })).id;
  const gen = await launchGeneration(t.db, { projectId: p!.id, scriptId, adapter: fakeAdapter(), tier: "final", durationS: 8, resolution: "720p" });
  await finishGeneration(t.db, gen.id, { kind: "completed" });
  await ingestRender(t.db, { generationId: gen.id, bytes: 100, checksum: "e", probe: async () => ({ durationS: 8 }) });
  genId = gen.id;
});

describe("platform export presets", () => {
  it("a TikTok export bundles file, caption+hashtags and the disclosure flag preset ON, recorded for audit", async () => {
    const exp = await createExport(t.db, {
      generationId: genId,
      platform: "tiktok",
      caption: "Morning routine upgrade",
      hashtags: ["#coffee", "#morning"],
      qualityConfirmedBy: USER,
    });
    expect(exp.filePath).toMatch(/renders\//);
    expect(exp.caption).toBe("Morning routine upgrade");
    expect(exp.hashtags).toEqual(["#coffee", "#morning"]);
    expect(exp.aiDisclosure).toBe(true); // default ON for AI-generated video
    expect(exp.platform).toBe("tiktok");
    expect(exp.generationId).toBe(genId);
  });

  it("a spec mismatch is surfaced with the platform's documented specs before download", async () => {
    const check = await checkExportSpecs(t.db, { generationId: genId, platform: "linkedin" });
    expect(check.ok).toBe(false);
    expect(check.mismatches.join(" ")).toMatch(/9:16.*linkedin|linkedin.*(1:1|16:9)/i);
    await expect(
      createExport(t.db, { generationId: genId, platform: "linkedin", caption: "x", hashtags: [], qualityConfirmedBy: USER }),
    ).rejects.toThrowError(/spec/i);
    const forced = await createExport(t.db, {
      generationId: genId,
      platform: "linkedin",
      caption: "x",
      hashtags: [],
      qualityConfirmedBy: USER,
      acknowledgeSpecMismatch: true,
    });
    expect(forced.platform).toBe("linkedin");
  });

  it("the export is refused without an explicit quality confirmation", async () => {
    await expect(createExport(t.db, { generationId: genId, platform: "tiktok", caption: "y", hashtags: [] })).rejects.toThrowError(/watched the video/i);
  });
});
