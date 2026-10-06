import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("~/server/media/supabase", () => ({ uploadToSupabase: vi.fn(async () => false) }));

import { createTestDb, type TestDb } from "~/test/db";
import { testCaller } from "~/test/caller";
import { seedFixture, type Fixture } from "~/test/fixture";
import { json, startServer } from "~/test/local-server";
import { generations, generationWatches, reconcileDueJobs } from "~/modules/generation";
import { getModelConfig } from "~/modules/models";
import { persistProviderRender } from "~/server/media/storage";
import { resetSecretBoxCache } from "~/server/settings/secrets";
import type { Machine } from "~/server/settings/urls";
import { loadModelCatalog } from "./adapters";

const USER = "d1111111-1111-4111-8111-111111111111";
let t: TestDb;
let fx: Fixture;
let folder: string;
const servers: { close: () => Promise<void> }[] = [];

beforeAll(async () => {
  t = await createTestDb();
  fx = await seedFixture(t.db, { userId: USER, name: "Local" });
  folder = await mkdtemp(join(tmpdir(), "troupe-local-"));
});
afterAll(async () => {
  await t.pg.close();
  await rm(folder, { recursive: true, force: true });
});
beforeEach(() => {
  vi.stubEnv("TROUPE_SECRET", "local-models-test");
  vi.stubEnv("TROUPE_DATA_DIR", folder);
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("GOOGLE_GENAI_API_KEY", "");
  vi.stubEnv("FAL_KEY", "");
  resetSecretBoxCache();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  resetSecretBoxCache();
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

const caps = {
  aspectRatios: ["9:16" as const],
  resolutions: ["720p" as const],
  durationsS: [8],
  audio: "optional" as const,
  dialogueLanguages: null,
};
const caller = async () => testCaller({ db: t.db, userId: USER, catalog: await loadModelCatalog(t.db) });

describe("local model names", () => {
  it("refuses a name another model already has, whatever its case", async () => {
    const draft = { family: "http" as const, label: "Twin box", baseUrl: "http://127.0.0.1:9", capabilities: caps };
    const { modelKey } = await (await caller()).settings.models.createLocal(draft);
    await expect(
      (await caller()).settings.models.createLocal({ ...draft, label: "  twin BOX " }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "A model is already called “Twin box”. Give this one another name so you can tell them apart.",
    });
    // A built-in model's name is taken too.
    await expect(
      (await caller()).settings.models.createLocal({ ...draft, label: "Veo 3.1 Fast" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const other = await (await caller()).settings.models.createLocal({ ...draft, label: "Other box" });
    await expect(
      (await caller()).settings.models.updateLocal({ modelKey: other.modelKey, label: "twin box" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Renaming a model to its own name (or its own name in another case) is fine.
    await (await caller()).settings.models.updateLocal({ modelKey, label: "Twin Box" });
  });
});

describe("a local model's last test", () => {
  it("is kept with the model, from its creation until a test passes", async () => {
    let up = false;
    const server = await startServer((r, res) =>
      up && r.path === "/health"
        ? json(res, 200, { ok: true, contract: 1 })
        : json(res, 503, { ok: false, error: "The box is warming up." }),
    );
    servers.push(server);
    const { modelKey } = await (await caller()).settings.models.createLocal({
      family: "http",
      label: "Warming box",
      baseUrl: server.url,
      capabilities: caps,
    });
    const listed = async () => (await (await caller()).settings.models.list()).models.find((m) => m.key === modelKey)!;
    // Added anyway (the server may come up later), and said to be out of reach.
    expect((await listed()).lastTest).toMatchObject({ ok: false, message: expect.stringMatching(/warming up/) });
    expect((await listed()).status).toBe("ready");
    up = true;
    expect(await (await caller()).settings.models.test({ modelKey })).toMatchObject({ ok: true });
    expect((await listed()).lastTest).toMatchObject({ ok: true });
    // Another address: what the old one answered no longer says anything.
    await (await caller()).settings.models.updateLocal({ modelKey, baseUrl: "http://127.0.0.1:9" });
    expect((await listed()).lastTest).toBeNull();
  });
});

describe("local models end to end", () => {
  it("adds an HTTP model with a sealed token and renders through it to a stored MP4", async () => {
    const clip = await readFile("src/test/fixtures/clip.mp4");
    const server = await startServer((r, res) => {
      if (r.headers.authorization !== "Bearer box-token") return json(res, 401, {});
      if (r.path === "/health") return json(res, 200, { ok: true, contract: 1 });
      if (r.method === "POST" && r.path === "/jobs") return json(res, 200, { id: "job-7" });
      if (r.path === "/jobs/job-7") return json(res, 200, { status: "succeeded", video_url: "/out/job-7.mp4" });
      if (r.path === "/out/job-7.mp4") {
        res.writeHead(200);
        res.end(clip);
        return;
      }
      json(res, 404, {});
    });
    servers.push(server);

    const draft = {
      family: "http" as const,
      label: "GPU box",
      baseUrl: server.url,
      token: "box-token",
      capabilities: caps,
    };
    expect(await (await caller()).settings.models.testDraft(draft)).toMatchObject({ ok: true });
    const { modelKey } = await (await caller()).settings.models.createLocal(draft);
    const row = await getModelConfig(t.db, modelKey);
    expect(row?.secretCiphertext).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain("box-token");

    const api = await caller();
    expect((await api.settings.models.list()).models.find((m) => m.key === modelKey)).toMatchObject({
      kind: "local",
      status: "ready",
      timeoutS: 7200,
      pricePerSecondUsd: 0,
    });
    const gen = await api.generation.launchText({
      projectId: fx.projectId,
      scriptId: fx.scriptId,
      modelKey,
      durationS: 8,
      resolution: "720p",
    });
    expect(gen).toMatchObject({ status: "in_progress", costUsd: "0", costSource: "estimate", provider: "http" });

    // Archiving does not strand the running job.
    await api.settings.models.archive({ modelKey, archived: true });
    const { adapters } = await loadModelCatalog(t.db);
    await t.db
      .update(generationWatches)
      .set({ nextPollAt: new Date(0) })
      .where(eq(generationWatches.generationId, gen.id));
    const results = await reconcileDueJobs(t.db, { adapters, ingest: persistProviderRender });
    expect(results.find((r) => r.generationId === gen.id)?.outcome).toBe("completed");
    const [done] = await t.db.select().from(generations).where(eq(generations.id, gen.id));
    expect(done!.outputAssetId).not.toBeNull();
  });

  it("polls an HTTP model at the pace its server advertised when tested, and relearns it on the next test", async () => {
    let pace = 1;
    const server = await startServer((r, res) => {
      if (r.path === "/health") return json(res, 200, { ok: true, contract: 1, poll_every_s: pace });
      if (r.method === "POST" && r.path === "/jobs") return json(res, 200, { id: "job-9" });
      if (r.path === "/jobs/job-9") return json(res, 200, { status: "running" });
      json(res, 404, {});
    });
    servers.push(server);

    const draft = { family: "http" as const, label: "Renderer", baseUrl: server.url, capabilities: caps };
    const report = await (await caller()).settings.models.testDraft(draft);
    expect(report).toMatchObject({ ok: true, pollEveryS: 1 });
    // The form sends what the test learned; the server keeps it in range.
    const { modelKey } = await (await caller()).settings.models.createLocal({
      ...draft,
      pollEveryS: report.pollEveryS,
    });
    expect((await getModelConfig(t.db, modelKey))?.connection).toMatchObject({ pollEveryS: 1 });
    expect((await loadModelCatalog(t.db)).adapters.get(modelKey)?.pollEveryS).toBe(1);

    // The orchestrator polls the launched job at that pace, from the first poll on.
    const before = Date.now();
    const gen = await (await caller()).generation.launchText({
      projectId: fx.projectId,
      scriptId: fx.scriptId,
      modelKey,
      durationS: 8,
      resolution: "720p",
    });
    const [watch] = await t.db.select().from(generationWatches).where(eq(generationWatches.generationId, gen.id));
    expect(watch!.nextPollAt.getTime() - before).toBeLessThan(5_000);
    await t.db
      .update(generationWatches)
      .set({ nextPollAt: new Date(0) })
      .where(eq(generationWatches.generationId, gen.id));
    const now = new Date();
    await reconcileDueJobs(t.db, { adapters: (await loadModelCatalog(t.db)).adapters, now });
    const [again] = await t.db.select().from(generationWatches).where(eq(generationWatches.generationId, gen.id));
    expect(again!.nextPollAt.getTime() - now.getTime()).toBe(1_000);

    // Testing the saved model again stores the pace the server asks for now.
    pace = 3;
    expect(await (await caller()).settings.models.test({ modelKey })).toMatchObject({ ok: true, pollEveryS: 3 });
    expect((await loadModelCatalog(t.db)).adapters.get(modelKey)?.pollEveryS).toBe(3);
    // An out-of-range value from a client is clamped, and moving the model to
    // another server forgets the old server's pace.
    const { modelKey: eager } = await (await caller()).settings.models.createLocal({
      ...draft,
      label: "Eager",
      pollEveryS: 0.01,
    });
    expect((await loadModelCatalog(t.db)).adapters.get(eager)?.pollEveryS).toBe(1);
    await (await caller()).settings.models.updateLocal({ modelKey: eager, baseUrl: "http://10.0.0.8:8000" });
    expect((await loadModelCatalog(t.db)).adapters.get(eager)?.pollEveryS).toBeUndefined();
  });

  it("keeps the pace on a failed test or a move on the same server, and forgets it when the server stops asking", async () => {
    let health: { status: number; body: Record<string, unknown> } = {
      status: 200,
      body: { ok: true, contract: 1, poll_every_s: 4 },
    };
    const server = await startServer((r, res) =>
      r.path === "/health" ? json(res, health.status, health.body) : json(res, 404, {}),
    );
    servers.push(server);
    const pace = async (key: string) => (await loadModelCatalog(t.db)).adapters.get(key)?.pollEveryS;
    const { modelKey } = await (await caller()).settings.models.createLocal({
      family: "http",
      label: "Paced",
      baseUrl: server.url,
      capabilities: caps,
      pollEveryS: 4,
    });

    health = { status: 503, body: { ok: false, error: "warming up" } };
    expect(await (await caller()).settings.models.test({ modelKey })).toMatchObject({ ok: false });
    expect(await pace(modelKey)).toBe(4);
    // Another path on the same server: the same server, the same pace.
    await (await caller()).settings.models.updateLocal({ modelKey, baseUrl: `${server.url}/v2` });
    expect(await pace(modelKey)).toBe(4);
    health = { status: 200, body: { ok: true, contract: 1 } };
    await (await caller()).settings.models.updateLocal({ modelKey, baseUrl: server.url });
    expect(await (await caller()).settings.models.test({ modelKey })).toMatchObject({ ok: true });
    expect(await pace(modelKey)).toBeUndefined();
    expect((await getModelConfig(t.db, modelKey))?.connection).not.toHaveProperty("pollEveryS");
  });

  it("asks the server of a model added without a test for its pace, after adding it", async () => {
    let asked = 0;
    const server = await startServer((r, res) => {
      if (r.path !== "/health") return json(res, 404, {});
      asked++;
      json(res, 200, { ok: true, contract: 1, poll_every_s: 2 });
    });
    servers.push(server);
    const { modelKey } = await (await caller()).settings.models.createLocal({
      family: "http",
      label: "Untested",
      baseUrl: server.url,
      capabilities: caps,
    });
    await expect
      .poll(async () => (await loadModelCatalog(t.db)).adapters.get(modelKey)?.pollEveryS, { timeout: 5000 })
      .toBe(2);
    expect(asked).toBe(1);
    // A pace sent with the form is not asked again; an unreachable server
    // adds the model all the same, at the default pace.
    await (await caller()).settings.models.createLocal({
      family: "http",
      label: "Told",
      baseUrl: server.url,
      capabilities: caps,
      pollEveryS: 2,
    });
    const { modelKey: away } = await (await caller()).settings.models.createLocal({
      family: "http",
      label: "Away",
      baseUrl: "http://127.0.0.1:9",
      capabilities: caps,
    });
    expect((await loadModelCatalog(t.db)).adapters.get(away)?.pollEveryS).toBeUndefined();
    expect(asked).toBe(1);
  });

  it("refuses a cloud metadata address and a broken custom workflow", async () => {
    const api = await caller();
    await expect(
      api.settings.models.createLocal({
        family: "http",
        label: "Nope",
        baseUrl: "http://169.254.169.254",
        capabilities: caps,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/metadata/i) });
    await expect(
      api.settings.models.createLocal({
        family: "comfyui",
        label: "UI export",
        baseUrl: "http://127.0.0.1:8188",
        workflow: { nodes: [], links: [] },
        capabilities: caps,
      }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/Export \(API\)/) });
  });

  it("edits a local model's address and token without exposing the token", async () => {
    const api = await caller();
    const { modelKey } = await api.settings.models.createLocal({
      family: "http",
      label: "Box",
      baseUrl: "http://10.0.0.5:8000",
      token: "first",
      capabilities: caps,
    });
    await expect(
      api.settings.models.updateLocal({ modelKey, baseUrl: "http://metadata.google.internal" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await api.settings.models.updateLocal({
      modelKey,
      baseUrl: "http://10.0.0.6:8000/",
      token: "second",
      label: "Box 2",
    });
    const connection = (await api.settings.models.connections()).find((c) => c.modelKey === modelKey);
    expect(connection).toEqual({ modelKey, baseUrl: "http://10.0.0.6:8000", templateId: null, hasToken: true });
    expect(JSON.stringify(await api.settings.models.connections())).not.toContain("second");
    // Same server, another path: the token stays. Another server: it is dropped.
    await api.settings.models.updateLocal({ modelKey, baseUrl: "http://10.0.0.6:8000/v2" });
    expect((await api.settings.models.connections()).find((c) => c.modelKey === modelKey)?.hasToken).toBe(true);
    await api.settings.models.updateLocal({ modelKey, baseUrl: "http://10.0.0.7:8000" });
    expect((await api.settings.models.connections()).find((c) => c.modelKey === modelKey)?.hasToken).toBe(false);
    await api.settings.models.updateLocal({ modelKey, token: "third" });
    await api.settings.models.updateLocal({ modelKey, clearToken: true });
    expect((await api.settings.models.connections()).find((c) => c.modelKey === modelKey)?.hasToken).toBe(false);
    expect((await (await caller()).settings.models.list()).models.find((m) => m.key === modelKey)?.label).toBe("Box 2");
  });

  it("adds a bundled ComfyUI template with its own capabilities and two-hour limit", async () => {
    const api = await caller();
    const { modelKey } = await api.settings.models.createLocal({
      family: "comfyui",
      label: "Wan on my Mac",
      baseUrl: "http://host.docker.internal:8188",
      templateId: "wan22-ti2v-5b",
    });
    const model = (await (await caller()).settings.models.list()).models.find((m) => m.key === modelKey)!;
    expect(model).toMatchObject({
      family: "comfyui",
      status: "ready",
      timeoutS: 7200,
      capabilities: { audio: "none" },
    });
    const options = await (await caller()).studio.modelOptions({ format: "9:16", language: "en" });
    expect(options.models.find((o) => o.key === modelKey)?.warnings.join(" ")).toMatch(/silent/);
  });

  it("suggests where ComfyUI is for the machine in the request context", async () => {
    const on = (machine: Machine | null) =>
      testCaller({ db: t.db, userId: USER, machine }).settings.models.suggestedAddress();
    expect((await on({ inContainer: true, platform: "linux" })).comfyui).toBe("http://host.docker.internal:8188");
    expect((await on({ inContainer: false, platform: "darwin" })).comfyui).toBe("http://127.0.0.1:8000");
    // Nothing to inspect, as in the browser edition: ComfyUI's command-line
    // port.
    expect((await on(null)).comfyui).toBe("http://127.0.0.1:8188");
  });
});
