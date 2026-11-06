import { describe, expect, it } from "vitest";

import { AdapterError } from "~/modules/generation";
import { createCatalogAdapter, downloadCatalogVideo } from "./catalog-adapter";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

// A fake provider: answers by URL, records every request (headers lower-cased).
function fakeProvider(route: (url: string) => { status?: number; body: unknown; headers?: Record<string, string> }) {
  const calls: Call[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers: Record<string, string> = {};
    new Headers(init?.headers as HeadersInit).forEach((v, k) => {
      headers[k] = v;
    });
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const answer = route(url);
    const body = answer.body instanceof Uint8Array ? answer.body : JSON.stringify(answer.body);
    return new Response(body as BodyInit, { status: answer.status ?? 200, headers: answer.headers });
  };
  return { fetch, calls };
}

const caps = {
  aspectRatios: ["16:9", "9:16"],
  resolutions: ["720p"],
  durationsS: [5, 10],
  audio: "optional" as const,
  dialogueLanguages: null,
};

const kling = (fetch: ReturnType<typeof fakeProvider>["fetch"], audio: "optional" | "none" = "optional") =>
  createCatalogAdapter({
    model: {
      modelKey: "openrouter-kwaivgi-kling-v3-0-pro",
      provider: "openrouter",
      modelId: "kwaivgi/kling-v3.0-pro",
      capabilities: { ...caps, audio },
    },
    apiKey: "or-secret",
    fetch,
  });

describe("a catalog model's renders", () => {
  it("starts an OpenRouter job and stores its reference as the provider job id", async () => {
    const or = fakeProvider(() => ({ body: { id: "job-7", status: "pending" } }));
    const { providerJobId } = await kling(or.fetch).createJob({
      prompt: "A lighthouse at dusk.",
      aspectRatio: "9:16",
      resolution: "720p",
      durationS: 5,
      audio: false,
    });
    expect(JSON.parse(providerJobId)).toEqual({ id: "job-7" });
    expect(or.calls[0]).toMatchObject({
      url: "https://openrouter.ai/api/v1/videos",
      headers: { authorization: "Bearer or-secret" },
      body: {
        model: "kwaivgi/kling-v3.0-pro",
        prompt: "A lighthouse at dusk.",
        aspect_ratio: "9:16",
        resolution: "720p",
        duration: 5,
        generate_audio: false,
      },
    });
  });

  it("tells a silent model nothing about sound", async () => {
    const or = fakeProvider(() => ({ body: { id: "job-8" } }));
    await kling(or.fetch, "none").createJob({
      prompt: "x",
      aspectRatio: "16:9",
      resolution: "720p",
      durationS: 5,
      audio: false,
    });
    expect(or.calls[0]!.body).not.toHaveProperty("generate_audio");
  });

  it("reports a refused key as the studio's own error, without the key", async () => {
    const or = fakeProvider(() => ({ status: 401, body: { error: { message: "No auth credentials found" } } }));
    const error = await kling(or.fetch)
      .createJob({ prompt: "x", aspectRatio: "16:9", resolution: "720p", durationS: 5, audio: true })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterError);
    expect((error as AdapterError).code).toBe("PROVIDER_AUTH");
    expect((error as Error).message).not.toContain("or-secret");
  });

  it("follows a stored job: pending, then the video and its cost, or the failure", async () => {
    let state: unknown = { id: "job-7", status: "in_progress" };
    const or = fakeProvider(() => ({ body: state }));
    const adapter = kling(or.fetch);
    const id = JSON.stringify({ id: "job-7" });
    expect(await adapter.getJob!(id)).toEqual({ kind: "pending" });
    state = { id: "job-7", status: "completed", usage: { cost: 0.84 } };
    expect(await adapter.getJob!(id)).toEqual({
      kind: "completed",
      providerJobId: id,
      eventType: "job.completed",
      outputUrl: "https://openrouter.ai/api/v1/videos/job-7/content?index=0",
      costUsd: 0.84,
    });
    state = { id: "job-7", status: "failed", error: "Blocked by the content policy." };
    expect(await adapter.getJob!(id)).toMatchObject({
      kind: "failed",
      errorCode: "PROVIDER_FAILED",
      detail: "Blocked by the content policy.",
    });
  });
});

describe("downloadCatalogVideo", () => {
  const mp4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]);

  it("sends the key to the provider's own host only, not past a redirect", async () => {
    const files = fakeProvider((url) =>
      url.startsWith("https://openrouter.ai/")
        ? { status: 302, body: {}, headers: { location: "https://cdn.example.com/v.mp4" } }
        : { body: mp4 },
    );
    const bytes = await downloadCatalogVideo(
      "openrouter",
      "or-secret",
      "https://openrouter.ai/api/v1/videos/job-7/content?index=0",
      files.fetch as typeof fetch,
    );
    expect(bytes.length).toBe(mp4.length);
    expect(files.calls[0]!.headers.authorization).toBe("Bearer or-secret");
    expect(files.calls[1]).toMatchObject({ url: "https://cdn.example.com/v.mp4" });
    expect(files.calls[1]!.headers.authorization).toBeUndefined();
  });

  it("refuses plain http and addresses on this network", async () => {
    const files = fakeProvider(() => ({ body: mp4 }));
    for (const address of ["http://cdn.example.com/v.mp4", "https://127.0.0.1/v.mp4", "https://10.0.0.5/v.mp4"])
      await expect(downloadCatalogVideo("xai", "k", address, files.fetch as typeof fetch)).rejects.toThrow(
        "Unrecognized video storage address.",
      );
    expect(files.calls).toHaveLength(0);
  });

  it("refuses a file that is not an MP4", async () => {
    const files = fakeProvider(() => ({ body: new TextEncoder().encode("<html>nope</html>") }));
    await expect(
      downloadCatalogVideo("xai", "k", "https://vidgen.x.ai/v.mp4", files.fetch as typeof fetch),
    ).rejects.toThrow("invalid MP4");
  });
});
