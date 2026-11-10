import { describe, expect, it } from "vitest";

import { AdapterError } from "~/modules/generation";
import { createCatalogAdapter, downloadCatalogVideo, spokenText, talkingVoice } from "./catalog-adapter";

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

const actor = {
  id: "a1",
  name: "Fatou",
  gender: "female" as const,
  ageRange: "25-34",
  voiceProfile: "warm",
  portraits: { front: "custom-actors/a1/v1/front.jpg", happy: "custom-actors/a1/v1/happy.jpg" },
};
const REFERENCE = "data:image/jpeg;base64,AAAA";

describe("the actor's picture", () => {
  const withFrames = (fetch: ReturnType<typeof fakeProvider>["fetch"], frameImages: string[], loaded: string[]) =>
    createCatalogAdapter({
      model: {
        modelKey: "openrouter-google-veo-3-1-lite",
        provider: "openrouter",
        modelId: "google/veo-3.1-lite",
        capabilities: caps,
        frameImages,
      },
      apiKey: "or-secret",
      fetch,
      loadReference: async (path, ratio) => {
        loaded.push(`${path} ${ratio}`);
        return REFERENCE;
      },
    });

  it("starts the video of a model that takes a first frame, framed like the video", async () => {
    const or = fakeProvider(() => ({ body: { id: "job-1" } }));
    const loaded: string[] = [];
    await withFrames(or.fetch, ["first_frame", "last_frame"], loaded).createJob({
      prompt: "She waves.",
      aspectRatio: "9:16",
      resolution: "720p",
      durationS: 5,
      audio: true,
      actor,
    });
    expect(loaded).toEqual(["custom-actors/a1/v1/front.jpg 9:16"]);
    const body = or.calls[0]!.body as { frame_images: unknown; prompt: string };
    expect(body.frame_images).toEqual([
      { type: "image_url", image_url: { url: REFERENCE }, frame_type: "first_frame" },
    ]);
    expect(body.prompt).toMatch(/^She waves\.\n\nThe first frame shows the actor/);
  });

  it("goes by the description on a model that takes no picture, or without an actor", async () => {
    const or = fakeProvider(() => ({ body: { id: "job-2" } }));
    const loaded: string[] = [];
    const base = { prompt: "A beach.", aspectRatio: "9:16", resolution: "720p", durationS: 5, audio: false };
    await withFrames(or.fetch, [], loaded).createJob({ ...base, actor });
    await withFrames(or.fetch, ["first_frame"], loaded).createJob(base);
    expect(loaded).toEqual([]);
    for (const call of or.calls) {
      expect(call.body).not.toHaveProperty("frame_images");
      expect((call.body as { prompt: string }).prompt).toBe("A beach.");
    }
  });

  it("goes on without it when it cannot be read", async () => {
    const or = fakeProvider(() => ({ body: { id: "job-3" } }));
    const adapter = createCatalogAdapter({
      model: {
        modelKey: "k",
        provider: "openrouter",
        modelId: "x/y",
        capabilities: caps,
        frameImages: ["first_frame"],
      },
      apiKey: "or-secret",
      fetch: or.fetch,
      loadReference: async () => null,
    });
    await adapter.createJob({
      prompt: "P",
      aspectRatio: "9:16",
      resolution: "720p",
      durationS: 5,
      audio: false,
      actor,
    });
    expect(or.calls[0]!.body).not.toHaveProperty("frame_images");
  });
});

describe("a talking photo", () => {
  const avatar = (fetch: ReturnType<typeof fakeProvider>["fetch"], reference: string | null = REFERENCE) =>
    createCatalogAdapter({
      model: {
        modelKey: "openrouter-heygen-avatar-iv",
        provider: "openrouter",
        modelId: "heygen/avatar-iv",
        capabilities: { ...caps, audio: "always", durationsS: [5, 10, 15] },
        frameImages: [],
        talking: true,
      },
      apiKey: "or-secret",
      fetch,
      loadReference: async () => reference,
    });

  it("animates the actor's picture and says the script's lines, in a voice of their gender and language", async () => {
    const or = fakeProvider(() => ({ body: { id: "job-4" } }));
    const adapter = avatar(or.fetch);
    expect(adapter.needsActor).toBe(true);
    await adapter.createJob({
      prompt: "UGC-style ad…",
      aspectRatio: "9:16",
      resolution: "720p",
      durationS: 10,
      audio: true,
      script: {
        lines: [
          { role: "hook", text: "Ce pull a changé mon automne.", emotion: "excited" },
          { role: "cta", text: "Le lien est en bio.", emotion: "calm" },
        ],
        actor,
        language: "fr",
      },
    });
    const body = or.calls[0]!.body as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "heygen/avatar-iv",
      prompt: "Ce pull a changé mon automne. Le lien est en bio.",
      aspect_ratio: "9:16",
      input_references: [{ type: "image_url", image_url: { url: REFERENCE } }],
      provider: { options: { heygen: { voice_id: talkingVoice("fr", "female") } } },
    });
    // Its length is the lines': no duration is asked.
    expect(body).not.toHaveProperty("duration");
    expect(body).not.toHaveProperty("frame_images");
  });

  it("says a shot's own text, not the actor's description", () => {
    expect(
      spokenText({
        prompt: "Hello there.\n\nOn screen: Fatou, adult, female.",
        shotText: "Hello there.",
        aspectRatio: "9:16",
        resolution: "720p",
        durationS: 5,
        audio: true,
      }),
    ).toBe("Hello there.");
  });

  it("is refused before any call without the actor's picture", async () => {
    const or = fakeProvider(() => ({ body: { id: "job-5" } }));
    await expect(
      avatar(or.fetch, null).createJob({
        prompt: "Hi",
        aspectRatio: "9:16",
        resolution: "720p",
        durationS: 5,
        audio: true,
        actor,
      }),
    ).rejects.toMatchObject({ code: "ACTOR_REQUIRED" });
    expect(or.calls).toEqual([]);
  });

  it("picks a voice by language and gender, English when HeyGen has none listed for the language", () => {
    expect(talkingVoice("en", "male")).not.toBe(talkingVoice("en", "female"));
    expect(talkingVoice("de", "male")).toBe(talkingVoice("en", "male"));
    expect(talkingVoice("es-MX", "female")).toBe(talkingVoice("es", "female"));
    expect(talkingVoice(undefined, "nonbinary")).toBe(talkingVoice("en", "female"));
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
