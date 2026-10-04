import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";

import { json, startServer } from "~/test/local-server";
import { createHttpEndpointAdapter, type HttpEndpointModel } from "./http-endpoint";

const caps = { aspectRatios: ["9:16", "16:9"], resolutions: ["480p", "720p"], durationsS: [4, 5, 8], audio: "optional" as const, dialogueLanguages: null };
const req = { prompt: "Hello there.", aspectRatio: "9:16", resolution: "720p", durationS: 5, audio: false };
let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; });

function model(baseUrl: string, patch: Partial<HttpEndpointModel> = {}): HttpEndpointModel {
  return { modelKey: "local-box", label: "Box", baseUrl, capabilities: caps, fps: 24, ...patch };
}

describe("generic HTTP endpoint adapter", () => {
  it("submits, polls and downloads a same-origin MP4, sending the token only to its own server", async () => {
    const clip = await readFile("src/test/fixtures/clip.mp4");
    let polls = 0;
    const server = await startServer((r, res) => {
      if (r.method === "POST" && r.path === "/jobs") return json(res, 200, { id: "job-1" });
      if (r.path === "/jobs/job-1") return json(res, 200, ++polls === 1 ? { status: "running", progress: 0.4 } : { status: "succeeded", video_url: "/files/job-1.mp4" });
      if (r.path === "/files/job-1.mp4") { res.writeHead(200, { "content-type": "video/mp4" }); res.end(clip); return; }
      json(res, 404, {});
    });
    close = server.close;
    const adapter = createHttpEndpointAdapter({ model: model(server.url, { token: "local-secret" }) });

    const { providerJobId } = await adapter.createJob(req);
    expect(providerJobId).toBe("job-1");
    expect(JSON.parse(server.requests[0]!.body)).toEqual({
      prompt: "Hello there.", aspect_ratio: "9:16", resolution: "720p", width: 720, height: 1280, duration_s: 5, fps: 24, audio: false,
    });
    expect(server.requests[0]!.headers.authorization).toBe("Bearer local-secret");
    expect(await adapter.getJob!(providerJobId)).toEqual({ kind: "pending", progress: 0.4 });
    const done = await adapter.getJob!(providerJobId);
    expect(done).toMatchObject({ kind: "completed", outputUrl: `${server.url}/files/job-1.mp4` });
    const bytes = await adapter.downloadResult!(`${server.url}/files/job-1.mp4`);
    expect(Buffer.from(bytes).equals(clip)).toBe(true);
  });

  it("sends the structured script with the job, in the contract's snake_case", async () => {
    const server = await startServer((_r, res) => json(res, 200, { id: "job-s" }));
    close = server.close;
    const script = {
      lines: [
        { role: "hook" as const, text: "Hello there.", emotion: "excited" as const },
        { role: "cta" as const, text: "Try it today.", emotion: "calm" as const },
      ],
      actor: { id: "a1111111-1111-4111-8111-111111111111", name: "Léa", gender: "female" as const, ageRange: "25-34", voiceProfile: "warm and enthusiastic, mid-tempo" },
      language: "fr",
    };
    await createHttpEndpointAdapter({ model: model(server.url) }).createJob({ ...req, script });
    expect(JSON.parse(server.requests[0]!.body)).toEqual({
      prompt: "Hello there.", aspect_ratio: "9:16", resolution: "720p", width: 720, height: 1280, duration_s: 5, fps: 24, audio: false,
      script: {
        language: "fr",
        actor: { id: "a1111111-1111-4111-8111-111111111111", name: "Léa", gender: "female", age_range: "25-34", voice_profile: "warm and enthusiastic, mid-tempo" },
        lines: [
          { role: "hook", text: "Hello there.", emotion: "excited" },
          { role: "cta", text: "Try it today.", emotion: "calm" },
        ],
      },
    });
  });

  it("refuses a video URL on another origin", async () => {
    const server = await startServer((_r, res) => json(res, 200, { status: "succeeded", video_url: "http://evil.example/x.mp4" }));
    close = server.close;
    const adapter = createHttpEndpointAdapter({ model: model(server.url, { token: "t" }) });
    expect(await adapter.getJob!("job-2")).toMatchObject({ kind: "failed", errorCode: "OUTPUT_FOREIGN_ORIGIN" });
    await expect(adapter.downloadResult!("http://evil.example/x.mp4")).rejects.toThrow(/origin/);
  });

  it("reports a failed job with a short excerpt of the endpoint's own message", async () => {
    const server = await startServer((_r, res) => json(res, 200, { status: "failed", error: "CUDA out of memory\n".repeat(30) }));
    close = server.close;
    const failed = await createHttpEndpointAdapter({ model: model(server.url) }).getJob!("job-3");
    expect(failed).toMatchObject({ kind: "failed", errorCode: "LOCAL_JOB_FAILED" });
    expect((failed as { detail: string }).detail.length).toBeLessThan(260);
    expect((failed as { detail: string }).detail).not.toContain("\n");
  });

  it("validates requests before calling the server", async () => {
    const server = await startServer((_r, res) => json(res, 200, { id: "x" }));
    close = server.close;
    await expect(createHttpEndpointAdapter({ model: model(server.url) }).createJob({ ...req, durationS: 6 })).rejects.toMatchObject({ code: "UNSUPPORTED_DURATION" });
    expect(server.requests).toHaveLength(0);
  });

  it("explains an unreachable server and an auth refusal without echoing bodies", async () => {
    const unreachable = createHttpEndpointAdapter({ model: model("http://127.0.0.1:1") });
    await expect(unreachable.createJob(req)).rejects.toMatchObject({ code: "LOCAL_UNREACHABLE" });
    const server = await startServer((_r, res) => json(res, 401, { secret: "do-not-echo" }));
    close = server.close;
    const refused = createHttpEndpointAdapter({ model: model(server.url) });
    await expect(refused.createJob(req)).rejects.toMatchObject({ code: "LOCAL_AUTH" });
    await refused.createJob(req).catch((e: Error) => expect(e.message).not.toContain("do-not-echo"));
  });

  it("checks /health and the contract version", async () => {
    let contract = 1;
    const server = await startServer((_r, res) => json(res, 200, { ok: true, contract }));
    close = server.close;
    const adapter = createHttpEndpointAdapter({ model: model(server.url) });
    expect(await adapter.testConnection!()).toMatchObject({ ok: true });
    contract = 2;
    expect(await adapter.testConnection!()).toMatchObject({ ok: false, message: expect.stringMatching(/contract 2/) });
  });

  it("shows why /health refused, from the server's own error, but never on an auth refusal", async () => {
    let status = 503;
    const server = await startServer((_r, res) => json(res, status, { ok: false, error: "The AI video mode is off on this renderer.\nStart it first." }));
    close = server.close;
    const adapter = createHttpEndpointAdapter({ model: model(server.url) });
    expect(await adapter.testConnection!()).toEqual({ ok: false, message: "Box returned HTTP 503: The AI video mode is off on this renderer. Start it first." });
    status = 401;
    expect(await adapter.testConnection!()).toEqual({ ok: false, message: "Box refused the token (HTTP 401). Check it in Settings." });
  });

  it("takes the polling pace a server advertises on /health, within 1 to 60 s", async () => {
    let pace: unknown = 1;
    const server = await startServer((_r, res) => json(res, 200, { ok: true, contract: 1, poll_every_s: pace }));
    close = server.close;
    const adapter = createHttpEndpointAdapter({ model: model(server.url) });
    expect(await adapter.testConnection!()).toEqual({
      ok: true,
      message: "Box is reachable and speaks contract 1.",
      details: ["It asks Troupe to check on renders every 1 s."],
      pollEveryS: 1,
    });
    pace = 0.2;
    expect(await adapter.testConnection!()).toMatchObject({ ok: true, pollEveryS: 1 });
    pace = 600;
    expect(await adapter.testConnection!()).toMatchObject({ ok: true, pollEveryS: 60 });
    pace = "fast";
    const ignored = await adapter.testConnection!();
    expect(ignored).toEqual({ ok: true, message: "Box is reachable and speaks contract 1." });
  });

  it("polls at the model's stored pace, clamped", () => {
    expect(createHttpEndpointAdapter({ model: model("http://127.0.0.1:9", { pollEveryS: 1 }) }).pollEveryS).toBe(1);
    expect(createHttpEndpointAdapter({ model: model("http://127.0.0.1:9", { pollEveryS: 0.01 }) }).pollEveryS).toBe(1);
    expect(createHttpEndpointAdapter({ model: model("http://127.0.0.1:9", { pollEveryS: 90 }) }).pollEveryS).toBe(60);
    expect(createHttpEndpointAdapter({ model: model("http://127.0.0.1:9") }).pollEveryS).toBeUndefined();
  });
});
