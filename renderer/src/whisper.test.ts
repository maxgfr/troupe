import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { createRendererServer, WHISPER_OFF } from "./server";
import { transcribeFile, whisperArgs, whisperReadiness, whisperSettingsFromEnv } from "./whisper";

const FAKE = ["node", join(import.meta.dirname, "..", "test", "fake-transcribe.mjs")];
const servers: Server[] = [];
const silent = async () => ({ samples: new Float32Array(0), sampleRate: 24000 });

async function start(options: Partial<Parameters<typeof createRendererServer>[0]> = {}): Promise<string> {
  const server = createRendererServer({
    speak: silent,
    outDir: join(import.meta.dirname, "..", "..", ".cache", "whisper-test"),
    log: () => {},
    ...options,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const scratch = mkdtempSync(join(tmpdir(), "troupe-whisper-scratch-"));

afterAll(() => {
  for (const server of servers) server.close();
  rmSync(scratch, { recursive: true, force: true });
});

const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(check()).toBe(true);
};

// A client that posts `sent` of `declared` bytes, then leaves when told to.
function leaving(base: string, declared: number, sent: number) {
  const req = request(`${base}/transcribe`, { method: "POST", headers: { "content-length": declared } });
  req.on("error", () => {});
  req.write(new Uint8Array(sent));
  if (sent === declared) req.end();
  return () => req.destroy();
}

describe("whisper settings", () => {
  it("defaults to faster-whisper base in int8 on the CPU, and checks each variable", () => {
    const settings = whisperSettingsFromEnv({}, ["uv", "run"]);
    expect(settings).toMatchObject({
      model: "base",
      computeType: "int8",
      device: "cpu",
      threads: 0,
      language: null,
      timeoutS: 1800,
      maxBytes: 300 * 1024 * 1024,
    });
    expect(whisperArgs({ ...settings, command: ["uv", "run", "python", "t.py"] }, "/tmp/a.flac")).toEqual([
      "run",
      "python",
      "t.py",
      "/tmp/a.flac",
      "--model",
      "base",
      "--compute-type",
      "int8",
      "--device",
      "cpu",
      "--threads",
      "0",
    ]);
    expect(
      whisperSettingsFromEnv(
        { WHISPER_MODEL: "small", WHISPER_LANGUAGE: "fr", WHISPER_COMMAND: "/venv/bin/python t.py" },
        [],
      ),
    ).toMatchObject({ model: "small", language: "fr", command: ["/venv/bin/python", "t.py"] });
    expect(() => whisperSettingsFromEnv({ WHISPER_MODEL: "base; rm -rf /" }, [])).toThrow("WHISPER_MODEL");
    expect(() => whisperSettingsFromEnv({ WHISPER_DEVICE: "tpu" }, [])).toThrow("WHISPER_DEVICE");
    expect(() => whisperSettingsFromEnv({ WHISPER_LANGUAGE: "english" }, [])).toThrow("WHISPER_LANGUAGE");
  });

  it("says when the program or its environment is missing", () => {
    expect(whisperReadiness(["no-such-program-troupe"])).toContain('"no-such-program-troupe", which is not installed');
    expect(whisperReadiness(["node"], "/nonexistent/.venv")).toContain("pnpm renderer:whisper:setup");
    expect(whisperReadiness(["node"])).toBeNull();
  });
});

describe("/transcribe", () => {
  const settings = { ...whisperSettingsFromEnv({}, FAKE), threads: 2, maxBytes: 64 };
  const whisper = {
    model: "base",
    maxBytes: 64,
    ready: () => null,
    transcribe: (file: string) => transcribeFile(settings, file),
  };

  it("is off unless enabled, and says how to turn it on", async () => {
    const base = await start();
    const health = await fetch(`${base}/transcribe/health`);
    expect(health.status).toBe(503);
    expect(await health.json()).toEqual({ ok: false, error: WHISPER_OFF });
    expect((await fetch(`${base}/transcribe`, { method: "POST", body: "x" })).status).toBe(503);
  });

  it("transcribes the posted sound, behind the token, within the size limit", async () => {
    const base = await start({ whisper, token: "secret" });
    expect((await fetch(`${base}/transcribe/health`)).status).toBe(401);
    const auth = { authorization: "Bearer secret" };
    expect(await (await fetch(`${base}/transcribe/health`, { headers: auth })).json()).toEqual({
      ok: true,
      model: "faster-whisper base",
    });
    const answer = await fetch(`${base}/transcribe`, { method: "POST", headers: auth, body: new Uint8Array(40) });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      language: "en",
      model: "faster-whisper base",
      duration: 2,
      segments: [{ start: 0, end: 2, text: "40 bytes, threads 2" }],
    });
    expect(
      (await fetch(`${base}/transcribe`, { method: "POST", headers: auth, body: new Uint8Array(65) })).status,
    ).toBe(413);
    expect((await fetch(`${base}/transcribe`, { method: "POST", headers: auth, body: new Uint8Array(0) })).status).toBe(
      400,
    );
  });

  it("cleans up after a client that leaves mid-upload, and stops a transcription nobody waits for", async () => {
    const folder = mkdtempSync(join(scratch, "leave-"));
    const started: string[] = [];
    let stopped = 0;
    const slow = {
      ...whisper,
      tmpDir: folder,
      transcribe: (file: string, signal?: AbortSignal) =>
        new Promise<never>((_resolve, reject) => {
          started.push(file);
          signal?.addEventListener("abort", () => {
            stopped += 1;
            reject(new Error("stopped"));
          });
        }),
    };
    const base = await start({ whisper: slow });
    const leaveUploading = leaving(base, 60, 10);
    await until(() => readdirSync(folder).length === 1);
    leaveUploading();
    await until(() => readdirSync(folder).length === 0);
    expect(started).toEqual([]);

    const leaveWaiting = leaving(base, 40, 40);
    await until(() => started.length === 1);
    leaveWaiting();
    await until(() => stopped === 1 && readdirSync(folder).length === 0);
  });

  it("answers when it cannot store the sound, and keeps serving", async () => {
    const notAFolder = join(scratch, "a-file");
    writeFileSync(notAFolder, "");
    const base = await start({ whisper: { ...whisper, tmpDir: notAFolder } });
    const answer = await fetch(`${base}/transcribe`, { method: "POST", body: new Uint8Array(4) });
    expect(answer.status).toBe(507);
    expect((await answer.json()).error).toMatch(/could not store the sound/);
    expect((await fetch(`${base}/transcribe/health`)).status).toBe(200);
  });

  it("passes on Whisper's error and its readiness problem", async () => {
    const failing = {
      ...whisper,
      transcribe: (file: string) =>
        transcribeFile({ ...settings, command: [...FAKE] }, file).then(() =>
          transcribeFile({ ...settings, command: [...FAKE, "--fail", "CUDA out of memory"] }, file),
        ),
    };
    const base = await start({ whisper: failing });
    const answer = await fetch(`${base}/transcribe`, { method: "POST", body: new Uint8Array(4) });
    expect(answer.status).toBe(500);
    expect(await answer.json()).toEqual({ error: "Whisper failed: RuntimeError: CUDA out of memory" });
    const unready = await start({ whisper: { ...whisper, ready: () => "Not set up." } });
    expect(await (await fetch(`${unready}/transcribe/health`)).json()).toEqual({ ok: false, error: "Not set up." });
  });
});
