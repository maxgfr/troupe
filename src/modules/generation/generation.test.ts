import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createTestDb, type TestDb } from "~/test/db";
import { fakeAdapter, finishGeneration } from "~/test/adapters";
import { createWorkspace } from "~/modules/identity";
import { projects } from "~/modules/studio/server/schema";
import { seedActorLibrary, listActors, attachActorToProject } from "~/modules/actors";
import { pasteScript } from "~/modules/script";
import { generations } from "~/modules/generation/server/schema";
import { AdapterError, launchGeneration } from "~/modules/generation";

const USER = "71111111-1111-4111-8111-111111111111";

let t: TestDb;
let ws: string;
let projectId: string;
let scriptId: string;
let voiceProfile: string;

beforeAll(async () => {
  t = await createTestDb();
  ws = (await createWorkspace(t.db, { userId: USER, name: "Gen" })).id;
  await seedActorLibrary(t.db);
  const actor = (await listActors(t.db, { gender: "female" }))[0]!;
  voiceProfile = actor.voiceProfile;
  const [p] = await t.db
    .insert(projects)
    .values({ workspaceId: ws, title: "Gen test", format: "9:16", platform: "tiktok", language: "fr" })
    .returning();
  projectId = p!.id;
  await attachActorToProject(t.db, { projectId, actorId: actor.id });
  scriptId = (await pasteScript(t.db, { projectId, text: "This ended my search for good coffee.\nGrab yours today." }))
    .id;
});

describe("text-to-video generation", () => {
  it("records provider, job id, compiled prompt and scriptId, then completes", async () => {
    const adapter = fakeAdapter({ jobId: "veo-job-1" });
    const gen = await launchGeneration(t.db, {
      projectId,
      scriptId,
      adapter,
      tier: "final",
      durationS: 8,
      resolution: "720p",
    });

    expect(gen.modelKey).toBe("veo");
    expect(gen.providerJobId).toBe("veo-job-1");
    expect(gen.scriptId).toBe(scriptId);
    expect(gen.status).toBe("in_progress");
    expect(gen.aspectRatio).toBe("9:16");
    expect(gen.durationS).toBe(8);
    // Every line's text + emotion tag + the actor's voice profile compiled in.
    expect(gen.prompt).toContain("This ended my search for good coffee.");
    expect(gen.prompt).toContain("[neutral]");
    expect(gen.prompt).toContain(voiceProfile);
    expect(adapter.calls[0]!.prompt).toBe(gen.prompt);

    expect(await finishGeneration(t.db, gen.id, { kind: "completed", costUsd: 3.2 })).toBe("completed");
    const [row] = await t.db.select().from(generations).where(eq(generations.id, gen.id));
    expect(row!.status).toBe("completed");
  });

  it("hands the model the structured script next to the prompt: lines, actor and language", async () => {
    const adapter = fakeAdapter({ jobId: "script-1" });
    await launchGeneration(t.db, { projectId, scriptId, adapter, tier: "draft", durationS: 8, resolution: "720p" });
    const actor = (await listActors(t.db, { gender: "female" }))[0]!;
    expect(adapter.calls[0]!.script).toEqual({
      lines: [
        { role: "hook", text: "This ended my search for good coffee.", emotion: "neutral" },
        { role: "cta", text: "Grab yours today.", emotion: "neutral" },
      ],
      actor: {
        id: actor.id,
        name: actor.name,
        gender: actor.gender,
        ageRange: actor.ageRange,
        voiceProfile: actor.voiceProfile,
        portraits: expect.any(Object),
      },
      language: "fr",
    });
    // The actor's pictures, by shot, at the storage paths of their current set.
    const folder = actor.portraitPath!.replace(/front\.webp$/, "");
    expect(adapter.calls[0]!.script!.actor.portraits).toEqual({
      front: `${folder}front.webp`,
      "profile-left": `${folder}profile-left.webp`,
      "profile-right": `${folder}profile-right.webp`,
      happy: `${folder}happy.webp`,
      calm: `${folder}calm.webp`,
      excited: `${folder}excited.webp`,
    });
    await launchGeneration(t.db, {
      projectId,
      scriptId,
      adapter,
      tier: "draft",
      durationS: 8,
      resolution: "720p",
      language: "en",
    });
    expect(adapter.calls[1]!.script!.language).toBe("en");
  });

  it("switching provider reuses the same adapter interface and leaves project fields untouched", async () => {
    const before = (await t.db.select().from(projects).where(eq(projects.id, projectId)))[0]!;
    const gen = await launchGeneration(t.db, {
      projectId,
      scriptId,
      adapter: fakeAdapter({ modelKey: "kling", jobId: "kling-1" }),
      tier: "final",
      durationS: 8,
      resolution: "720p",
    });
    expect(gen.modelKey).toBe("kling");
    const after = (await t.db.select().from(projects).where(eq(projects.id, projectId)))[0]!;
    expect(after).toEqual(before);
  });

  it("a second terminal outcome changes nothing", async () => {
    const gen = await launchGeneration(t.db, {
      projectId,
      scriptId,
      adapter: fakeAdapter(),
      tier: "final",
      durationS: 8,
      resolution: "720p",
    });
    expect(await finishGeneration(t.db, gen.id, { kind: "completed" })).toBe("completed");
    expect(await finishGeneration(t.db, gen.id, { kind: "failed", errorCode: "LATE" })).toBe("duplicate");
    const [row] = await t.db.select().from(generations).where(eq(generations.id, gen.id));
    expect(row!.status).toBe("completed");
  });

  it("a failed job ends failed with the provider error code", async () => {
    const gen = await launchGeneration(t.db, {
      projectId,
      scriptId,
      adapter: fakeAdapter(),
      tier: "final",
      durationS: 8,
      resolution: "720p",
    });
    expect(await finishGeneration(t.db, gen.id, { kind: "failed", errorCode: "SAFETY_BLOCK" })).toBe("failed");
    const [row] = await t.db.select().from(generations).where(eq(generations.id, gen.id));
    expect(row!.status).toBe("failed");
    expect(row!.errorCode).toBe("SAFETY_BLOCK");
  });

  it("capability guard — a model without 1:1 refuses it before any provider call", async () => {
    const [p11] = await t.db
      .insert(projects)
      .values({ workspaceId: ws, title: "Square", format: "1:1", platform: "instagram", language: "fr" })
      .returning();
    const adapter = fakeAdapter();
    await expect(
      launchGeneration(t.db, {
        projectId: p11!.id,
        scriptId,
        adapter,
        tier: "final",
        durationS: 8,
        resolution: "720p",
      }),
    ).rejects.toThrowError(/1:1/);
    expect(adapter.calls).toHaveLength(0);
  });

  it("a script longer than the clip is refused at launch before contacting the provider", async () => {
    const fifty = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
    const longScript = await pasteScript(t.db, { projectId, text: fifty });
    const adapter = fakeAdapter();
    await expect(
      launchGeneration(t.db, {
        projectId,
        scriptId: longScript.id,
        adapter,
        tier: "final",
        durationS: 8,
        resolution: "720p",
      }),
    ).rejects.toThrowError(/shorten/i);
    expect(adapter.calls).toHaveLength(0);
  });

  it("records the cost estimate at launch, and none when the model refused the job", async () => {
    const ok = await launchGeneration(t.db, {
      projectId,
      scriptId,
      adapter: fakeAdapter(),
      tier: "final",
      durationS: 8,
      resolution: "720p",
      estimatedCostUsd: 1.2,
    });
    expect(ok).toMatchObject({ costUsd: "1.2", costSource: "estimate" });
    const refused = await launchGeneration(t.db, {
      projectId,
      scriptId,
      tier: "final",
      durationS: 8,
      resolution: "720p",
      estimatedCostUsd: 1.2,
      adapter: fakeAdapter({
        createJob: async () => {
          throw new AdapterError("PROVIDER_AUTH", "The key was rejected.");
        },
      }),
    });
    expect(refused).toMatchObject({
      status: "failed",
      errorCode: "PROVIDER_AUTH",
      errorDetail: "The key was rejected.",
      costUsd: null,
      costSource: null,
    });
  });

  it("two generations with the same actor record its id and asset version", async () => {
    const g1 = await launchGeneration(t.db, {
      projectId,
      scriptId,
      adapter: fakeAdapter(),
      tier: "final",
      durationS: 8,
      resolution: "720p",
    });
    const g2 = await launchGeneration(t.db, {
      projectId,
      scriptId,
      adapter: fakeAdapter(),
      tier: "final",
      durationS: 8,
      resolution: "720p",
    });
    expect(g1.actorId).not.toBeNull();
    expect(g1.actorId).toBe(g2.actorId);
    expect(g1.actorAssetVersion).toBe(g2.actorAssetVersion);
  });

  it("asks for audio by default and refuses settings outside the model's capabilities before any call", async () => {
    const speaking = fakeAdapter();
    await launchGeneration(t.db, {
      projectId,
      scriptId,
      adapter: speaking,
      tier: "final",
      durationS: 8,
      resolution: "720p",
    });
    expect(speaking.calls[0]!.audio).toBe(true);
    const silent = fakeAdapter({ capabilities: { audio: "none", resolutions: ["720p"], durationsS: [4, 8] } });
    await launchGeneration(t.db, {
      projectId,
      scriptId,
      adapter: silent,
      tier: "final",
      durationS: 8,
      resolution: "720p",
    });
    expect(silent.calls[0]!.audio).toBe(false);
    await expect(
      launchGeneration(t.db, { projectId, scriptId, adapter: silent, tier: "final", durationS: 6, resolution: "720p" }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_DURATION" });
    await expect(
      launchGeneration(t.db, {
        projectId,
        scriptId,
        adapter: silent,
        tier: "final",
        durationS: 8,
        resolution: "1080p",
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_RESOLUTION" });
    expect(silent.calls).toHaveLength(1);
  });
});
