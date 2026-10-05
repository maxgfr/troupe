import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createTestDb, type TestDb } from "~/test/db";
import { json, startServer } from "~/test/local-server";
import { archiveLocalModel, createLocalModel, getDefaultModelKey, getModelConfig, listModelConfigs, setDefaultModelKey, updateLocalModel } from "~/modules/models";
import { resetSecretBoxCache } from "~/server/settings/secrets";
import { loadModelCatalog } from "./adapters";
import { autoconfigureSettings, registerStackRenderer, STACK_RENDERER_KEY, startAutoconfigure } from "./autoconfigure";

let t: TestDb;
let folder: string;
const servers: { close: () => Promise<void> }[] = [];

beforeEach(async () => {
  t = await createTestDb();
  folder = await mkdtemp(join(tmpdir(), "troupe-autoconfigure-"));
  vi.stubEnv("TROUPE_SECRET", "autoconfigure-test");
  vi.stubEnv("TROUPE_DATA_DIR", folder);
  resetSecretBoxCache();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  resetSecretBoxCache();
  await t.pg.close();
  await rm(folder, { recursive: true, force: true });
  await Promise.all(servers.splice(0).map((s) => s.close()));
});
afterAll(() => vi.useRealTimers());

// A renderer answering /health the way renderer/src/server.ts does.
async function renderer(opts: { token?: string; pace?: number } = {}) {
  const server = await startServer((r, res) => {
    if (opts.token && r.headers.authorization !== `Bearer ${opts.token}`) return json(res, 401, {});
    if (r.path === "/health") return json(res, 200, { ok: true, contract: 1, poll_every_s: opts.pace ?? 1 });
    json(res, 404, {});
  });
  servers.push(server);
  return server;
}

const settingsFor = (url: string, extra: Record<string, string> = {}) => autoconfigureSettings({ TROUPE_AUTOCONFIGURE: "1", TROUPE_RENDERER_URL: url, ...extra })!;

describe("autoconfigureSettings", () => {
  it("is off unless TROUPE_AUTOCONFIGURE is on and a renderer address is given", () => {
    expect(autoconfigureSettings({})).toBeNull();
    expect(autoconfigureSettings({ TROUPE_AUTOCONFIGURE: "1" })).toBeNull();
    expect(autoconfigureSettings({ TROUPE_AUTOCONFIGURE: "0", TROUPE_RENDERER_URL: "http://renderer:8078" })).toBeNull();
    expect(autoconfigureSettings({ TROUPE_RENDERER_URL: "http://renderer:8078" })).toBeNull();
  });

  it("reads the renderer's address, name, token and clip lengths, with defaults", () => {
    expect(autoconfigureSettings({ TROUPE_AUTOCONFIGURE: "true", TROUPE_RENDERER_URL: "http://renderer:8078" })).toEqual({
      renderer: { url: "http://renderer:8078", label: "Local renderer", token: undefined, durationsS: [4, 6, 8, 10, 15] },
    });
    expect(autoconfigureSettings({
      TROUPE_AUTOCONFIGURE: "1", TROUPE_RENDERER_URL: "http://renderer:8078", TROUPE_RENDERER_LABEL: " Kokoro box ",
      TROUPE_RENDERER_TOKEN: "s3cret", TROUPE_RENDERER_DURATIONS: "30, 5,5 ,12",
    })?.renderer).toEqual({ url: "http://renderer:8078", label: "Kokoro box", token: "s3cret", durationsS: [5, 12, 30] });
  });

  it("refuses clip lengths it cannot use", () => {
    for (const bad of ["", "abc", "0", "61", "4,x", "2.5"]) {
      if (bad === "") continue;
      expect(() => settingsFor("http://renderer:8078", { TROUPE_RENDERER_DURATIONS: bad })).toThrow(/TROUPE_RENDERER_DURATIONS/);
    }
  });
});

describe("registerStackRenderer", () => {
  it("adds the stack's renderer as a tested local model, makes it the default, and does it once", async () => {
    const server = await renderer({ pace: 1 });
    expect(await registerStackRenderer(t.db, settingsFor(server.url))).toBe("created");

    const row = await getModelConfig(t.db, STACK_RENDERER_KEY);
    expect(row).toMatchObject({
      family: "http", label: "Local renderer", archived: false,
      capabilities: { aspectRatios: ["9:16", "16:9", "1:1"], resolutions: ["480p", "540p", "576p", "720p", "1080p"], durationsS: [4, 6, 8, 10, 15], audio: "always", dialogueLanguages: null },
      // What Test learns and Add model saves in Settings.
      connection: { baseUrl: server.url, fps: 24, pollEveryS: 1 },
      timeoutS: 7200,
    });
    expect(await getDefaultModelKey(t.db)).toBe(STACK_RENDERER_KEY);
    expect((await loadModelCatalog(t.db)).models.find((m) => m.key === STACK_RENDERER_KEY)).toMatchObject({ status: "ready", kind: "local" });

    // Every later start finds it and leaves it alone, renamed or not.
    await updateLocalModel(t.db, STACK_RENDERER_KEY, { label: "Renamed" });
    expect(await registerStackRenderer(t.db, settingsFor(server.url))).toBe("exists");
    expect((await getModelConfig(t.db, STACK_RENDERER_KEY))?.label).toBe("Renamed");
    expect((await listModelConfigs(t.db)).filter((r) => r.family === "http")).toHaveLength(1);
  });

  it("never brings back a renderer the user archived", async () => {
    const server = await renderer();
    await registerStackRenderer(t.db, settingsFor(server.url));
    await archiveLocalModel(t.db, STACK_RENDERER_KEY);
    expect(await registerStackRenderer(t.db, settingsFor(server.url))).toBe("exists");
    expect((await getModelConfig(t.db, STACK_RENDERER_KEY))?.archived).toBe(true);
  });

  it("keeps the user's default model and the renderer they added themselves", async () => {
    const server = await renderer();
    await setDefaultModelKey(t.db, "veo-3.1-fast");
    const own = await createLocalModel(t.db, {
      family: "http", label: "My renderer", connection: { baseUrl: `${server.url}/` },
      capabilities: { aspectRatios: ["9:16"], resolutions: ["720p"], durationsS: [8], audio: "always", dialogueLanguages: null },
    });
    expect(await registerStackRenderer(t.db, settingsFor(server.url))).toBe("already-added");
    expect(await getModelConfig(t.db, STACK_RENDERER_KEY)).toBeNull();
    expect((await getModelConfig(t.db, own))?.label).toBe("My renderer");

    // Another address: added, but the default stays the user's.
    await archiveLocalModel(t.db, own);
    const other = await renderer();
    expect(await registerStackRenderer(t.db, settingsFor(other.url, { TROUPE_RENDERER_LABEL: "Stack renderer" }))).toBe("created");
    expect(await getDefaultModelKey(t.db)).toBe("veo-3.1-fast");
  });

  it("does not take a name another model already has", async () => {
    const server = await renderer();
    expect(await registerStackRenderer(t.db, settingsFor(server.url, { TROUPE_RENDERER_LABEL: "veo 3.1 fast" }))).toBe("name-taken");
    expect(await getModelConfig(t.db, STACK_RENDERER_KEY)).toBeNull();
  });

  it("stores nothing while the renderer does not answer, and seals its token once it does", async () => {
    const server = await renderer({ token: "tok-123" });
    expect(await registerStackRenderer(t.db, settingsFor("http://127.0.0.1:9"))).toBe("unreachable");
    expect(await registerStackRenderer(t.db, settingsFor(server.url))).toBe("unreachable");
    expect(await getModelConfig(t.db, STACK_RENDERER_KEY)).toBeNull();

    expect(await registerStackRenderer(t.db, settingsFor(server.url, { TROUPE_RENDERER_TOKEN: "tok-123" }))).toBe("created");
    const row = await getModelConfig(t.db, STACK_RENDERER_KEY);
    expect(row?.secretCiphertext).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain("tok-123");
    expect((await loadModelCatalog(t.db)).models.find((m) => m.key === STACK_RENDERER_KEY)?.status).toBe("ready");
  });
});

describe("startAutoconfigure", () => {
  it("retries until the renderer answers, then stops", async () => {
    let up = false;
    const server = await startServer((r, res) => {
      if (!up) return json(res, 503, { ok: false });
      if (r.path === "/health") return json(res, 200, { ok: true, contract: 1, poll_every_s: 1 });
      json(res, 404, {});
    });
    servers.push(server);
    const events: string[] = [];
    const run = startAutoconfigure(t.db, { TROUPE_AUTOCONFIGURE: "1", TROUPE_RENDERER_URL: server.url }, {
      retryEveryMs: 20, giveUpAfterMs: 5_000, log: (event) => events.push(event.outcome as string),
    });
    await new Promise((r) => setTimeout(r, 100));
    up = true;
    expect(await run).toBe("created");
    expect(events.at(-1)).toBe("created");
    expect(events.filter((e) => e === "unreachable").length).toBeGreaterThan(0);
  });

  it("gives up after a while and does nothing when switched off", async () => {
    const events: string[] = [];
    expect(await startAutoconfigure(t.db, { TROUPE_AUTOCONFIGURE: "1", TROUPE_RENDERER_URL: "http://127.0.0.1:9" }, {
      retryEveryMs: 10, giveUpAfterMs: 60, log: (event) => events.push(event.outcome as string),
    })).toBe("unreachable");
    expect(events.at(-1)).toBe("gave-up");
    expect(await startAutoconfigure(t.db, {}, { log: (event) => events.push(event.outcome as string) })).toBe("off");
  });
});
