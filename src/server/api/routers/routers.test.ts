import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createTestDb, type TestDb } from "~/test/db";
import { testCaller } from "~/test/caller";
import { seedFixture, type Fixture } from "~/test/fixture";
import { createWorkspace, workspaces } from "~/modules/identity";
import { createDraftProject, projects } from "~/modules/studio";
import { chatMessages } from "~/modules/chat";
import { catalogOf, fakeAdapter } from "~/test/adapters";
import type { VideoProviderAdapter } from "~/modules/generation";

const MEMBER = "a1111111-1111-4111-8111-111111111111";
const STRANGER = "a2222222-2222-4222-8222-222222222222";

const adapters: VideoProviderAdapter[] = [
  fakeAdapter({ modelKey: "veo" }),
  fakeAdapter({ modelKey: "kling" }),
];

let t: TestDb;
let fx: Fixture;

beforeAll(async () => {
  t = await createTestDb();
  fx = await seedFixture(t.db, { userId: MEMBER, name: "Routers" });
});

const asMember = () => testCaller({ db: t.db, userId: MEMBER, adapters });
const asStranger = () => testCaller({ db: t.db, userId: STRANGER, adapters });
const anon = () => testCaller({ db: t.db, userId: null, adapters });

describe("studio router", () => {
  it("a member drives the wizard over HTTP and reads the project back", async () => {
    const project = await asMember().studio.createFromWizard({ workspaceId: fx.workspaceId, title: "Over HTTP", platform: "tiktok", format: "9:16", language: "en", actorId: fx.actorId });
    await asMember().studio.updateChoices({ projectId: project.id, platform: "linkedin", format: "16:9", language: "fr" });
    const reopened = await asMember().studio.getProject({ projectId: project.id });
    expect(reopened.platform).toBe("linkedin");
    expect(reopened.format).toBe("16:9");
  });

  it("renames and deletes a project; a stranger can do neither", async () => {
    const other = await seedFixture(t.db, { userId: MEMBER, name: "Disposable" });
    await expect(asStranger().studio.deleteProject({ projectId: other.projectId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await asMember().studio.updateChoices({ projectId: other.projectId, title: "  Renamed  " })).title).toBe("Renamed");
    await asMember().studio.deleteProject({ projectId: other.projectId });
    await expect(asMember().studio.getProject({ projectId: other.projectId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("formatOptions surfaces the crop/letterbox warnings", async () => {
    const options = await asMember().studio.formatOptions({ platform: "tiktok" });
    expect(options.find((o) => o.format === "1:1")!.warning).toMatch(/crop|letterbox/i);
  });

  it("a non-member is FORBIDDEN, an anonymous caller UNAUTHORIZED", async () => {
    await expect(asStranger().studio.getProject({ projectId: fx.projectId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(anon().studio.getProject({ projectId: fx.projectId })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("actors router", () => {
  it("the library lists over HTTP", async () => {
    const list = await asMember().actors.list({});
    expect(list.length).toBeGreaterThan(0);
    // Each with its front portrait, served from public/actors.
    for (const actor of list) expect(actor.portraitUrl).toMatch(/^\/actors\/[a-z]+-\d{2}\/v1\/front\.webp$/);
  });
});

describe("script router", () => {
  it("paste then re-emotion a line over HTTP", async () => {
    const updated = await asMember().script.setLineEmotion({ projectId: fx.projectId, scriptId: fx.scriptId, lineIndex: 0, emotion: "excited" });
    expect(updated.lines[0]!.emotion).toBe("excited");
  });

  it("retags the newest version in place until a render or the chat uses it, then adds a version", async () => {
    const own = await seedFixture(t.db, { userId: MEMBER, name: "Retag" });
    const versions = async () => (await asMember().script.history({ projectId: own.projectId })).map((v) => v.version);
    const first = await asMember().script.setLineEmotion({ projectId: own.projectId, scriptId: own.scriptId, lineIndex: 0, emotion: "excited" });
    const second = await asMember().script.setLineEmotion({ projectId: own.projectId, scriptId: own.scriptId, lineIndex: 0, emotion: "calm" });
    expect([first.id, second.id]).toEqual([own.scriptId, own.scriptId]);
    expect(await versions()).toEqual([1]);

    // Once rendered, a version stays as it was rendered.
    await asMember().generation.launchText({ projectId: own.projectId, scriptId: own.scriptId, modelKey: "veo", durationS: 8, resolution: "720p" });
    const third = await asMember().script.setLineEmotion({ projectId: own.projectId, scriptId: own.scriptId, lineIndex: 0, emotion: "happy" });
    expect(third.id).not.toBe(own.scriptId);
    expect(await versions()).toEqual([1, 2]);
    // Retagging an older version always makes a new one.
    const fourth = await asMember().script.setLineEmotion({ projectId: own.projectId, scriptId: own.scriptId, lineIndex: 0, emotion: "serious" });
    expect(fourth.version).toBe(3);
  });

  it("adds a version when the chat refers to the newest one", async () => {
    const own = await seedFixture(t.db, { userId: MEMBER, name: "Retag chat" });
    await t.db.insert(chatMessages).values({ projectId: own.projectId, role: "user", content: "Sharper", baseScriptId: own.scriptId });
    const retagged = await asMember().script.setLineEmotion({ projectId: own.projectId, scriptId: own.scriptId, lineIndex: 0, emotion: "calm" });
    expect(retagged.id).not.toBe(own.scriptId);
    expect(retagged.version).toBe(2);
  });

  it("pastes a script with an emotion per line as one version; untagged lines keep their emotion", async () => {
    const own = await seedFixture(t.db, { userId: MEMBER, name: "Tagged paste" });
    await asMember().script.setLineEmotion({ projectId: own.projectId, scriptId: own.scriptId, lineIndex: 0, emotion: "serious" });
    const saved = await asMember().script.paste({ projectId: own.projectId, text: "Hook line. Body line. Call to action now.\nA second line.\nThe end.", emotions: [null, "excited", "calm"] });
    expect(saved.lines.map((l) => [l.role, l.emotion])).toEqual([["hook", "serious"], ["body", "excited"], ["cta", "calm"]]);
    expect((await asMember().script.history({ projectId: own.projectId })).map((v) => v.version)).toEqual([1, 2]);
    await expect(asMember().script.paste({ projectId: own.projectId, text: "One.\nTwo.", emotions: ["calm"] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("a stranger cannot read the script", async () => {
    await expect(asStranger().script.history({ projectId: fx.projectId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a scriptId from another project is FORBIDDEN even for its own workspace member", async () => {
    const other = await seedFixture(t.db, { userId: MEMBER, name: "Other" });
    await expect(asMember().script.setLineEmotion({ projectId: fx.projectId, scriptId: other.scriptId, lineIndex: 0, emotion: "calm" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("generation router", () => {
  it("a member launches a text-to-video render over HTTP", async () => {
    const gen = await asMember().generation.launchText({
      projectId: fx.projectId,
      scriptId: fx.scriptId,
      modelKey: "veo",
      durationS: 8,
      resolution: "720p",
    });
    expect(gen).toBeTruthy();
  });

  it("refuses to start a job on a disabled or archived model, explaining why", async () => {
    const veo = fakeAdapter({ modelKey: "veo" });
    const off = testCaller({ db: t.db, userId: MEMBER, catalog: catalogOf([veo], { patch: { veo: { enabled: false, label: "Veo" } } }) });
    await expect(
      off.generation.launchText({ projectId: fx.projectId, scriptId: fx.scriptId, modelKey: "veo", durationS: 8, resolution: "720p" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Veo is turned off in Settings." });
    expect(veo.calls).toHaveLength(0);
    await expect(asMember().studio.updateChoices({ projectId: fx.projectId, modelKey: "nonsense" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("relaunches a failed render with the same script, model and settings", async () => {
    const flaky = fakeAdapter({ modelKey: "flaky", createJob: async () => { throw new Error("busy"); } });
    const steady = fakeAdapter({ modelKey: "flaky" });
    const failed = await testCaller({ db: t.db, userId: MEMBER, adapters: [flaky] }).generation.launchText({ projectId: fx.projectId, scriptId: fx.scriptId, modelKey: "flaky", durationS: 6, resolution: "720p" });
    expect(failed.status).toBe("failed");
    const again = await testCaller({ db: t.db, userId: MEMBER, adapters: [steady] }).generation.relaunch({ projectId: fx.projectId, generationId: failed.id });
    expect(again).toMatchObject({ status: "in_progress", modelKey: "flaky", scriptId: fx.scriptId, durationS: 6, resolution: "720p", tier: "draft" });
    expect(again.id).not.toBe(failed.id);
    await expect(testCaller({ db: t.db, userId: MEMBER, adapters: [steady] }).generation.relaunch({ projectId: fx.projectId, generationId: again.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("launches are drafts whatever the client asks: only an export makes a render final", async () => {
    const launched = await asMember().generation.launchText({ projectId: fx.projectId, scriptId: fx.scriptId, modelKey: "veo", tier: "final", durationS: 8, resolution: "720p" } as never);
    expect(launched.tier).toBe("draft");
  });

  it("two relaunches of one failure at the same moment start one render", async () => {
    const flaky = fakeAdapter({ modelKey: "race", createJob: async () => { throw new Error("busy"); } });
    const steady = fakeAdapter({ modelKey: "race" });
    const failed = await testCaller({ db: t.db, userId: MEMBER, adapters: [flaky] }).generation.launchText({ projectId: fx.projectId, scriptId: fx.scriptId, modelKey: "race", durationS: 6, resolution: "720p" });
    const caller = testCaller({ db: t.db, userId: MEMBER, adapters: [steady] });
    const results = await Promise.allSettled([caller.generation.relaunch({ projectId: fx.projectId, generationId: failed.id }), caller.generation.relaunch({ projectId: fx.projectId, generationId: failed.id })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ code: "BAD_REQUEST", message: "This render was already relaunched. Follow the newer render in the timeline." });
    expect(steady.calls).toHaveLength(1);
  });

  it("relaunches a failed render once, and the timeline says it was relaunched", async () => {
    const flaky = fakeAdapter({ modelKey: "once", createJob: async () => { throw new Error("busy"); } });
    const steady = fakeAdapter({ modelKey: "once" });
    const failed = await testCaller({ db: t.db, userId: MEMBER, adapters: [flaky] }).generation.launchText({ projectId: fx.projectId, scriptId: fx.scriptId, modelKey: "once", durationS: 6, resolution: "720p" });
    const again = await testCaller({ db: t.db, userId: MEMBER, adapters: [steady] }).generation.relaunch({ projectId: fx.projectId, generationId: failed.id });
    expect(again.parentGenerationId).toBe(failed.id);
    await expect(testCaller({ db: t.db, userId: MEMBER, adapters: [steady] }).generation.relaunch({ projectId: fx.projectId, generationId: failed.id }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: "This render was already relaunched. Follow the newer render in the timeline." });
    expect(steady.calls).toHaveLength(1);
    const timeline = await testCaller({ db: t.db, userId: MEMBER, adapters: [steady] }).generation.forProject({ projectId: fx.projectId });
    expect(timeline.find((g) => g.id === failed.id)).toMatchObject({ relaunched: true });
    expect(timeline.find((g) => g.id === again.id)).toMatchObject({ relaunched: false, mediaDurationS: null, progress: null, burnedCaptions: false });
  });

  it("BAD_REQUEST when the chosen model has no configured key", async () => {
    const noKeys = testCaller({ db: t.db, userId: MEMBER, adapters: [] });
    await expect(
      noKeys.generation.launchText({ projectId: fx.projectId, scriptId: fx.scriptId, modelKey: "veo", durationS: 8, resolution: "720p" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("BAD_REQUEST, with the reason, when the script is longer than the clip", async () => {
    await expect(asMember().generation.launchText({ projectId: fx.projectId, scriptId: fx.scriptId, modelKey: "veo", durationS: 1, resolution: "720p" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/takes about \d+s to say, but the clip is 1s/) });
  });

  it("a stranger cannot launch a render", async () => {
    await expect(
      asStranger().generation.launchText({ projectId: fx.projectId, scriptId: fx.scriptId, modelKey: "veo", durationS: 8, resolution: "720p" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("benchmark router", () => {
  it("a member starts a two-provider benchmark over HTTP", async () => {
    const run = await asMember().benchmark.start({
      projectId: fx.projectId,
      scriptId: fx.scriptId,
      modelKeys: ["veo", "kling"],
      durationS: 8,
      resolution: "720p",
    });
    expect(run).toBeTruthy();
  });

  it("get carries the projectId the run was launched from (adopt needs it)", async () => {
    const started = await asMember().benchmark.start({
      projectId: fx.projectId,
      scriptId: fx.scriptId,
      modelKeys: ["veo", "kling"],
      durationS: 8,
      resolution: "720p",
    });
    const view = await asMember().benchmark.get({ workspaceId: fx.workspaceId, runId: started!.id });
    expect(view.projectId).toBe(fx.projectId);
  });

  it("comparison renders are drafts, like every render until it is exported", async () => {
    const started = await asMember().benchmark.start({ projectId: fx.projectId, scriptId: fx.scriptId, modelKeys: ["veo", "kling"], durationS: 8, resolution: "720p" });
    const timeline = await asMember().generation.forProject({ projectId: fx.projectId });
    const entries = await asMember().benchmark.get({ workspaceId: fx.workspaceId, runId: started!.id });
    const ids = new Set(entries.entries.map((e) => e.generationId));
    expect(timeline.filter((g) => ids.has(g.id)).map((g) => g.tier)).toEqual(["draft", "draft"]);
  });
});

describe("identity/workspace scoping is enforced at the router edge", () => {
  it("a valid session with no membership sees no workspaces", async () => {
    // A brand-new user in their own fresh workspace cannot reach ours.
    const solo = "a4444444-4444-4444-8444-444444444444";
    await createWorkspace(t.db, { userId: solo, name: "Solo" });
    await expect(testCaller({ db: t.db, userId: solo }).studio.getProject({ projectId: fx.projectId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lists workspaces oldest first and projects newest first", async () => {
    const user = "a5555555-5555-4555-8555-555555555555";
    await createWorkspace(t.db, { userId: user, name: "Second" });
    const first = await createWorkspace(t.db, { userId: user, name: "First" });
    await t.db.update(workspaces).set({ createdAt: new Date(Date.now() - 120_000) }).where(eq(workspaces.id, first.id));
    const caller = testCaller({ db: t.db, userId: user });
    expect((await caller.identity.myWorkspaces()).map((w) => w.name)).toEqual(["First", "Second"]);
    const older = await createDraftProject(t.db, { workspaceId: first.id, title: "Older" });
    await t.db.update(projects).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(projects.id, older.id));
    await createDraftProject(t.db, { workspaceId: first.id, title: "Newer" });
    expect((await caller.identity.projects({ workspaceId: first.id })).map((p) => p.title)).toEqual(["Newer", "Older"]);
  });
});
