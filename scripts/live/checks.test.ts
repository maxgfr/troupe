import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { fal, google } from "~/test/provider-fixtures";
import { json, startServer } from "~/test/local-server";
import { describeCost, freeCheck, paidTotal, planChecks, planTable, runCheck, runsNow, type Deps } from "./checks";
import { builtinModels } from "~/modules/models";

// pnpm verify:live's checks against local fakes of each provider: the same
// requests the live run makes, answered with the recorded responses.

const KEY = "AIza-live-check-test-key-0000";
const response = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data });
let folder: string;
let clip: Buffer;

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "troupe-live-"));
  clip = await readFile("src/test/fixtures/clip.mp4");
});
afterAll(async () => rm(folder, { recursive: true, force: true }));
afterEach(() => vi.unstubAllGlobals());

const deps = (env: Record<string, string>, http: Deps["http"], fetcher: typeof fetch = fetch): Deps => ({
  env,
  http,
  fetch: fetcher,
  outDir: folder,
  ffprobe: async () => ({ codec: "h264", width: 720, height: 1280, durationS: 4 }),
  sleep: async () => undefined,
  log: () => undefined,
});

describe("the plan", () => {
  it("skips each provider with nothing configured, saying which variable it reads", () => {
    const checks = planChecks({});
    expect(checks.map((c) => [c.id, c.skip])).toEqual([
      ["google", "no GEMINI_API_KEY, GOOGLE_API_KEY or GOOGLE_GENAI_API_KEY"],
      ["fal", "no FAL_KEY"],
      ["anthropic", "no ANTHROPIC_API_KEY"],
      ["ollama", "no OLLAMA_URL"],
      ["comfyui", "no TROUPE_LIVE_COMFYUI_URL (or COMFYUI_URL)"],
      ["supabase", "no SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"],
      ["studio", "no TROUPE_LIVE_STUDIO_URL and RECONCILE_SECRET"],
    ]);
    expect(paidTotal(checks)).toEqual({ lowUsd: 0, highUsd: 0, unknown: [] });
  });

  it("picks the cheapest model and settings per provider and prices them, never showing a key", () => {
    const env = { GEMINI_API_KEY: KEY, FAL_KEY: "fal-secret:1234", ANTHROPIC_API_KEY: "sk-ant-secret" };
    const checks = planChecks(env);
    expect(checks.slice(0, 3).map((c) => [c.id, c.job, describeCost(c), c.skip])).toEqual([
      ["google", "Veo 3.1 Lite (veo-3.1-lite-generate-preview), one 4 s 720p 9:16 clip", "about $0.20", null],
      [
        "fal",
        "Seedance 1.5 Pro (fal-ai/bytedance/seedance/v1.5/pro/text-to-video), one 4 s 480p 9:16 clip, silent",
        "about $0.05",
        null,
      ],
      // Adaptive thinking is billed as output: a range, not a point.
      ["anthropic", "claude-opus-5-5, one script chat answer", "about $0.03–0.10", null],
    ]);
    expect(paidTotal(checks)).toEqual({ lowUsd: 0.28, highUsd: 0.35, unknown: [] });
    const table = planTable(checks);
    for (const secret of Object.values(env)) expect(table).not.toContain(secret);
    expect(describeCost(planChecks({ ...env, TROUPE_LIVE_FAL_MODEL: "kling-3.0" })[1]!)).toBe("about $0.25");
    expect(describeCost(planChecks({ ...env, TROUPE_LIVE_VEO_MODEL: "veo-3.1-fast" })[0]!)).toBe("about $0.40");
  });

  it("never runs a paid provider without --yes, even when its price is unknown", () => {
    // A newer Veo with no list price yet.
    const env = {
      GEMINI_API_KEY: KEY,
      TROUPE_LIVE_COMFYUI_URL: "http://127.0.0.1:8188",
      TROUPE_LIVE_VEO_MODEL: "veo-next",
    };
    const veo = builtinModels({}).find((m) => m.key === "veo-3.1-lite")!;
    const unpriced = [
      ...builtinModels({}),
      { ...veo, key: "veo-next", modelId: "veo-next-generate-preview", pricePerSecondUsd: null },
    ];
    const [google] = planChecks(env, unpriced);
    expect(google).toMatchObject({ paid: true, estimate: null });
    expect(describeCost(google!)).toBe("price unknown");
    expect(planTable([google!])).toContain("price unknown");
    expect(paidTotal([google!])).toEqual({ lowUsd: 0, highUsd: 0, unknown: ["Google Gemini API"] });
    expect(runsNow(google!, false)).toBe(false);
    expect(runsNow(google!, true)).toBe(true);
    // A free job (a local render) runs without --yes.
    const comfy = planChecks(env, unpriced).find((c) => c.id === "comfyui")!;
    expect([comfy.paid, describeCost(comfy), runsNow(comfy, false)]).toEqual([false, "free", true]);
  });

  it("refuses a model of the wrong provider for TROUPE_LIVE_VEO_MODEL or TROUPE_LIVE_FAL_MODEL", () => {
    expect(() => planChecks({ TROUPE_LIVE_VEO_MODEL: "kling-3.0" })).toThrow(
      'TROUPE_LIVE_VEO_MODEL must name a Google model (veo-3.1-fast, veo-3.1-lite), not "kling-3.0".',
    );
    expect(() => planChecks({ TROUPE_LIVE_FAL_MODEL: "veo-3.1-lite" })).toThrow(
      'TROUPE_LIVE_FAL_MODEL must name a fal.ai model (kling-3.0, seedance-1.5-pro), not "veo-3.1-lite".',
    );
    expect(() => planChecks({ TROUPE_LIVE_FAL_MODEL: "nope" })).toThrow(
      /TROUPE_LIVE_FAL_MODEL must name a fal.ai model/,
    );
  });
});

describe("the checks, against local fakes", () => {
  it("renders on Veo: submit, poll, download through the signed redirect, ffprobe", async () => {
    const http = vi
      .fn()
      .mockResolvedValueOnce(response(google.operationStarted))
      .mockResolvedValueOnce(response(google.operationRunning))
      .mockResolvedValueOnce(response(google.operationDone));
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "https://storage.googleapis.com/veo/out.mp4?sig=1" } }),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array(clip)));
    vi.stubGlobal("fetch", fetcher);
    const env = { GEMINI_API_KEY: KEY };
    const line = await runCheck(planChecks(env)[0]!, deps(env, http));
    expect(line).toBe(`h264 720x1280, 4.00 s, in 0 s: ${join(folder, "veo-3.1-lite.mp4")}`);
    expect(await readFile(join(folder, "veo-3.1-lite.mp4"))).toEqual(clip);
    expect(http.mock.calls[0]![0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-lite-generate-preview:predictLongRunning",
    );
    expect(JSON.parse(http.mock.calls[0]![1].body).parameters).toEqual({
      aspectRatio: "9:16",
      durationSeconds: 4,
      resolution: "720p",
    });
  });

  it("renders on fal.ai silent at 480p and reads the video from fal's CDN", async () => {
    const endpoint = "fal-ai/bytedance/seedance/v1.5/pro/text-to-video";
    const http = vi
      .fn()
      .mockResolvedValueOnce(response(fal.submitted(endpoint)))
      .mockResolvedValueOnce(response(fal.inProgress))
      .mockResolvedValueOnce(response(fal.completed))
      .mockResolvedValueOnce(response(fal.output));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array(clip))));
    const env = { FAL_KEY: "fal-key" };
    await runCheck(planChecks(env)[1]!, deps(env, http));
    expect(JSON.parse(http.mock.calls[0]![1].body)).toMatchObject({
      duration: "4",
      resolution: "480p",
      generate_audio: false,
      aspect_ratio: "9:16",
    });
  });

  it("reports a refused key from the free check", async () => {
    const env = { GEMINI_API_KEY: KEY, FAL_KEY: "fal-key" };
    const [googleCheck, falCheck] = planChecks(env);
    expect(
      await freeCheck(googleCheck!, deps(env, vi.fn().mockResolvedValue(response(google.invalidKey, 400)))),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/rejected this API key/) });
    expect(
      await freeCheck(
        falCheck!,
        deps(env, vi.fn().mockResolvedValue(response(fal.pricing("fal-ai/bytedance/seedance/v1.5/pro/text-to-video")))),
      ),
    ).toMatchObject({ ok: true });
  });

  it("asks Ollama for one script and checks a deployed studio's job check", async () => {
    const ollama = await startServer((r, res) => {
      if (r.path === "/api/tags") return json(res, 200, { models: [{ name: "qwen3:4b" }] });
      if (r.path === "/api/chat")
        return json(res, 200, {
          message: {
            role: "assistant",
            content: JSON.stringify({
              summary: "Warmer.",
              lines: [{ role: "hook", text: "Hi, friend! Try this.", emotion: "happy" }],
              actor: null,
            }),
          },
        });
      json(res, 404, {});
    });
    const studio = await startServer((r, res) => {
      if (r.path === "/api/health") return json(res, 200, { ok: true });
      if (r.path === "/api/jobs/reconcile" && r.method === "POST")
        return r.headers["x-reconcile-secret"] === "s3cret"
          ? json(res, 200, { processed: 1, counts: { pending: 1 } })
          : json(res, 401, {});
      json(res, 404, {});
    });
    try {
      const env = { OLLAMA_URL: ollama.url, TROUPE_LIVE_STUDIO_URL: studio.url, RECONCILE_SECRET: "s3cret" };
      const checks = planChecks(env);
      expect(await runCheck(checks.find((c) => c.id === "ollama")!, deps(env, vi.fn()))).toMatch(
        /^qwen3:4b proposed a script: /,
      );
      expect(await runCheck(checks.find((c) => c.id === "studio")!, deps(env, vi.fn()))).toBe(
        `${studio.url} is up; the job check ran (1 job processed).`,
      );
      const wrong = { ...env, RECONCILE_SECRET: "other" };
      await expect(runCheck(planChecks(wrong).find((c) => c.id === "studio")!, deps(wrong, vi.fn()))).rejects.toThrow(
        /RECONCILE_SECRET differs/,
      );
    } finally {
      await ollama.close();
      await studio.close();
    }
  });
});
