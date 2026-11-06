import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "~/test/db";
import { seedFixture, type Fixture } from "~/test/fixture";
import { testCaller } from "~/test/caller";
import { fakeAdapter, finishGeneration, type FakeAdapter } from "~/test/adapters";
import type { Db } from "~/server/db/types";

const MEMBER = "81111111-1111-4111-8111-111111111111";
const STRANGER = "82222222-2222-4222-8222-222222222222";

let t: TestDb;
let db: Db;
let fx: Fixture;
let model: FakeAdapter;

beforeAll(async () => {
  t = await createTestDb();
  db = t.db as unknown as Db;
  await seedFixture(db, { userId: STRANGER, name: "Stranger" });
});

// A workspace of its own for every test: none sees another's shots.
beforeEach(async () => {
  fx = await seedFixture(db, { userId: MEMBER, name: "Shots router" });
  model = fakeAdapter({ modelKey: "fal-kling", family: "fal" });
});

const caller = (userId = MEMBER, adapters = [model]) => testCaller({ db, userId, adapters });

const SHOT = {
  modelKeys: ["fal-kling"],
  aspectRatio: "16:9",
  durationS: 5,
  resolution: "720p",
  text: "A slow dolly toward a steaming cup of coffee at dawn.",
};

describe("shots router", () => {
  it("renders a described shot without any script, in the format asked for", async () => {
    const [launched] = await caller().shots.launch({ workspaceId: fx.workspaceId, ...SHOT });
    expect(launched).toMatchObject({ status: "in_progress" });
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]).toMatchObject({ prompt: SHOT.text, aspectRatio: "16:9", durationS: 5, resolution: "720p" });
    expect(model.calls[0]!.script).toBeUndefined();

    const gallery = await caller().shots.list({ workspaceId: fx.workspaceId });
    expect(gallery).toHaveLength(1);
    expect(gallery[0]).toMatchObject({ prompt: SHOT.text, modelLabel: "fal-kling", favorite: false, videoUrl: null });
  });

  it("renders the same shot several times when asked, each its own render", async () => {
    const launched = await caller().shots.launch({ workspaceId: fx.workspaceId, ...SHOT, count: 3 });
    expect(launched).toHaveLength(3);
    expect(new Set(launched.map((l) => l.id)).size).toBe(3);
    expect(model.calls).toHaveLength(3);
  });

  it("renders the same shot on several models side by side, sound left to each model's rule", async () => {
    const veo = fakeAdapter({ modelKey: "veo", family: "veo", capabilities: { audio: "always" } });
    const silent = fakeAdapter({ modelKey: "silent", capabilities: { audio: "none" } });
    const launched = await caller(MEMBER, [model, veo, silent]).shots.launch({
      workspaceId: fx.workspaceId,
      ...SHOT,
      modelKeys: ["fal-kling", "veo", "silent"],
      audio: false,
      count: 2,
    });
    expect(launched.map((l) => l.modelKey)).toEqual(["fal-kling", "veo", "silent", "fal-kling", "veo", "silent"]);
    expect(model.calls.map((c) => c.audio)).toEqual([false, false]);
    expect(veo.calls.map((c) => c.audio)).toEqual([true, true]);
    expect(silent.calls.map((c) => c.audio)).toEqual([false, false]);
    const gallery = await caller(MEMBER, [model, veo, silent]).shots.list({ workspaceId: fx.workspaceId });
    expect(new Set(gallery.map((s) => s.modelLabel))).toEqual(new Set(["fal-kling", "veo", "silent"]));
  });

  it("calls no model when one of the chosen models cannot take the settings, and names it", async () => {
    const square = fakeAdapter({ modelKey: "square", aspectRatios: ["1:1"] });
    await expect(
      caller(MEMBER, [model, square]).shots.launch({
        workspaceId: fx.workspaceId,
        ...SHOT,
        modelKeys: ["fal-kling", "square"],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/^square: .*16:9/) });
    expect(model.calls).toHaveLength(0);
    expect(square.calls).toHaveLength(0);
    expect(await caller().shots.list({ workspaceId: fx.workspaceId })).toHaveLength(0);
  });

  it("caps a launch at eight renders in all", async () => {
    const others = ["a", "b", "c"].map((k) => fakeAdapter({ modelKey: k }));
    await expect(
      caller(MEMBER, [model, ...others]).shots.launch({
        workspaceId: fx.workspaceId,
        ...SHOT,
        modelKeys: ["fal-kling", "a", "b", "c"],
        count: 3,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("At most 8 renders") });
    expect(model.calls).toHaveLength(0);
  });

  it("describes the chosen actor in the prompt", async () => {
    await caller().shots.launch({ workspaceId: fx.workspaceId, ...SHOT, actorId: fx.actorId });
    expect(model.calls[0]!.prompt).toMatch(/^A slow dolly .*\n\nOn screen: .+, adult, .+ style\. Voice: .+\.$/s);
  });

  it("keeps its renders out of the projects list", async () => {
    await caller().shots.launch({ workspaceId: fx.workspaceId, ...SHOT });
    await caller().shots.launch({ workspaceId: fx.workspaceId, ...SHOT });
    const listed = await caller().identity.projects({ workspaceId: fx.workspaceId });
    expect(listed.map((p) => p.id)).toEqual([fx.projectId]);
  });

  it("refuses settings the model cannot render, before any model call", async () => {
    await expect(
      caller().shots.launch({ workspaceId: fx.workspaceId, ...SHOT, aspectRatio: "1:1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("not the 1:1 format") });
    expect(model.calls).toHaveLength(0);
  });

  it("offers the in-browser renderer as one that needs a project", async () => {
    const browser = fakeAdapter({ modelKey: "browser", family: "browser" });
    const { models } = await caller(MEMBER, [model, browser]).shots.models({ workspaceId: fx.workspaceId });
    expect(models.find((m) => m.key === "browser")).toMatchObject({
      needsScript: true,
      available: false,
      unavailableReason: expect.stringContaining("Launch it from a project"),
    });
    expect(models.find((m) => m.key === "fal-kling")).toMatchObject({ needsScript: false, available: true });
    await expect(
      caller(MEMBER, [model, browser]).shots.launch({ workspaceId: fx.workspaceId, ...SHOT, modelKeys: ["browser"] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(browser.calls).toHaveLength(0);
  });

  it("keeps favorites in their own scope", async () => {
    const [a, b] = await caller().shots.launch({ workspaceId: fx.workspaceId, ...SHOT, count: 2 });
    await caller().shots.favorite({ workspaceId: fx.workspaceId, generationId: a!.id, on: true });
    const favorites = await caller().shots.list({ workspaceId: fx.workspaceId, favorites: true });
    expect(favorites.map((s) => s.id)).toEqual([a!.id]);
    await caller().shots.favorite({ workspaceId: fx.workspaceId, generationId: a!.id, on: false });
    expect(await caller().shots.list({ workspaceId: fx.workspaceId, favorites: true })).toHaveLength(0);
    expect((await caller().shots.list({ workspaceId: fx.workspaceId })).map((s) => s.id).sort()).toEqual(
      [a!.id, b!.id].sort(),
    );
  });

  it("refuses to delete a shot still rendering, and deletes it once it has finished", async () => {
    const [shot] = await caller().shots.launch({ workspaceId: fx.workspaceId, ...SHOT });
    await expect(
      caller().shots.delete({ workspaceId: fx.workspaceId, generationIds: [shot!.id] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("still rendering") });
    await finishGeneration(db, shot!.id, { kind: "failed", errorCode: "X" });
    expect(await caller().shots.delete({ workspaceId: fx.workspaceId, generationIds: [shot!.id] })).toEqual({
      deleted: 1,
    });
    expect(await caller().shots.list({ workspaceId: fx.workspaceId })).toHaveLength(0);
  });

  it("relaunches a failed shot once, with the same text and settings", async () => {
    const [shot] = await caller().shots.launch({ workspaceId: fx.workspaceId, ...SHOT });
    await finishGeneration(db, shot!.id, { kind: "failed", errorCode: "X" });
    await caller().shots.relaunch({ workspaceId: fx.workspaceId, generationId: shot!.id });
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1]).toMatchObject({ prompt: SHOT.text, aspectRatio: "16:9", durationS: 5 });
    await expect(
      caller().shots.relaunch({ workspaceId: fx.workspaceId, generationId: shot!.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("already relaunched") });
    // The retried shot can be deleted though its relaunch points at it.
    expect(await caller().shots.delete({ workspaceId: fx.workspaceId, generationIds: [shot!.id] })).toEqual({
      deleted: 1,
    });
  });

  it("shows a workspace's shots to its members only", async () => {
    const [shot] = await caller().shots.launch({ workspaceId: fx.workspaceId, ...SHOT });
    await expect(caller(STRANGER).shots.list({ workspaceId: fx.workspaceId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller(STRANGER).shots.favorite({ workspaceId: fx.workspaceId, generationId: shot!.id, on: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
