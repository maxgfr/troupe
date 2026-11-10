import {
  checkVideo,
  startVideo,
  testVideoKey,
  type VideoOptions,
  type VideoRequest,
  type VideoSettings,
} from "llm-connect/video";

import {
  AdapterError,
  type ConnectionReport,
  type CreateJobRequest,
  type ModelCapabilities,
  type ProviderJobStatus,
  type VideoProviderAdapter,
} from "~/modules/generation";
import { videoBytes } from "~/modules/generation/server/adapters/download";
import type { CatalogProviderId } from "~/modules/models";

// A model added from a provider's catalog, rendered through llm-connect's
// start/status flow: the provider's job reference is stored as the
// generation's providerJobId, so a render survives a restart.

export interface CatalogModel {
  modelKey: string;
  provider: CatalogProviderId;
  // The id the provider's API takes.
  modelId: string;
  capabilities: ModelCapabilities;
  // The frames a picture can pin ("first_frame"), as the catalog listed them.
  frameImages?: string[];
  // A talking photo (HeyGen Avatar on OpenRouter): it animates the actor's
  // picture and says the lines with a voice of its own.
  talking?: boolean;
}

// The actor's picture, framed like the video, as a data URL; null when it
// cannot be read (the render then goes without it).
export type LoadReference = (storagePath: string, aspectRatio: string) => Promise<string | null>;

// HeyGen's stock voices a talking photo says the lines with, by language and
// gender (OpenRouter lists them when a launch has none). Another language
// takes the English voice: HeyGen's voices read other languages too.
export const TALKING_VOICES: Record<string, { female: string; male: string }> = {
  en: { female: "16a09e4706f74997ba4ed05ea11470f6", male: "6be73833ef9a4eb0aeee399b8fe9d62b" },
  es: { female: "246cdbf530954380a62109f3107fce0d", male: "707365599f8545d5b6ce7a32a20e9c93" },
  fr: { female: "4b1de1582d2c477485ad2e0c2717f0ff", male: "29b464727cc249f3bdf42f82562409f8" },
};

export function talkingVoice(language: string | undefined, gender: "female" | "male" | "nonbinary"): string {
  const voices = TALKING_VOICES[(language ?? "en").slice(0, 2).toLowerCase()] ?? TALKING_VOICES.en!;
  return gender === "male" ? voices.male : voices.female;
}

// What a talking photo says: the script's lines, or the shot's text.
export function spokenText(req: CreateJobRequest): string {
  if (req.script?.lines.length) return req.script.lines.map((l) => l.text.trim()).join(" ");
  return (req.shotText ?? req.prompt).trim();
}

const FIRST_FRAME_NOTE =
  "The first frame shows the actor: keep the same person, face, hair and clothes from start to end.";

// The request llm-connect sends: the actor's picture as the first frame of
// a model that takes one, or as the picture a talking photo animates.
export async function catalogVideoRequest(
  model: CatalogModel,
  req: CreateJobRequest,
  loadReference: LoadReference | undefined,
): Promise<VideoRequest> {
  const actor = req.script?.actor ?? req.actor;
  const front = actor?.portraits?.front;
  const takesFrame = Boolean(model.frameImages?.includes("first_frame"));
  const reference =
    front && loadReference && (model.talking || takesFrame) ? await loadReference(front, req.aspectRatio) : null;
  const base = {
    aspectRatio: req.aspectRatio,
    resolution: req.resolution,
    // Only a model that offers the choice is told; the others keep their own.
    ...(model.capabilities.audio === "optional" ? { audio: req.audio } : {}),
  };
  if (model.talking) {
    if (!actor || !reference)
      throw new AdapterError("ACTOR_REQUIRED", "This model animates an actor's picture, and none could be read.");
    return {
      ...base,
      prompt: spokenText(req),
      providerOptions: {
        openrouter: {
          input_references: [{ type: "image_url", image_url: { url: reference } }],
          provider: { options: { heygen: { voice_id: talkingVoice(req.script?.language, actor.gender) } } },
        },
      },
    };
  }
  return {
    ...base,
    prompt: reference ? `${req.prompt}\n\n${FIRST_FRAME_NOTE}` : req.prompt,
    durationS: req.durationS,
    ...(reference ? { image: { url: reference } } : {}),
  };
}

// llm-connect's error codes, as the adapter error codes the studio shows.
const ERROR_CODE: Record<string, string> = {
  auth: "PROVIDER_AUTH",
  "auth-or-network": "PROVIDER_AUTH",
  "rate-limit": "PROVIDER_QUOTA",
  overloaded: "PROVIDER_HTTP",
  "invalid-request": "PROVIDER_REJECTED",
  "not-found": "PROVIDER_MODEL_NOT_FOUND",
  server: "PROVIDER_HTTP",
};

// The provider's own API hosts: the only ones a video download may send the
// key to (OpenRouter's content endpoint and Google's files need it).
const KEYED_HOSTS: Partial<
  Record<CatalogProviderId, { host: string; header: (key: string) => Record<string, string> }>
> = {
  openrouter: { host: "openrouter.ai", header: (key) => ({ authorization: `Bearer ${key}` }) },
  google: { host: "generativelanguage.googleapis.com", header: (key) => ({ "x-goog-api-key": key }) },
};

const PRIVATE_HOST =
  /^(localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[|0\.)/i;

// Fetch a finished video: https only, no address on this network, at most a
// few redirects, the key only to the provider's own host, the size capped.
export async function downloadCatalogVideo(
  provider: CatalogProviderId,
  apiKey: string,
  address: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  let url = new URL(address);
  const keyed = KEYED_HOSTS[provider];
  for (let redirects = 0; redirects < 5; redirects++) {
    if (url.protocol !== "https:" || url.username || url.password || PRIVATE_HOST.test(url.hostname))
      throw new Error("Unrecognized video storage address.");
    const headers = keyed && url.hostname === keyed.host && !url.port ? keyed.header(apiKey) : {};
    const response = await fetchImpl(url, { headers, redirect: "manual", signal: AbortSignal.timeout(120_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get("location");
      if (!next) throw new Error("Video redirect has no location.");
      url = new URL(next, url);
      continue;
    }
    return videoBytes(response);
  }
  throw new Error("Too many video redirects.");
}

export function createCatalogAdapter(deps: {
  model: CatalogModel;
  apiKey: string;
  // The fetch llm-connect calls the provider with (tests pass a fake one).
  fetch?: VideoOptions["fetch"];
  // Reads the actor's picture for the models that take one.
  loadReference?: LoadReference;
}): VideoProviderAdapter {
  const { model, apiKey } = deps;
  const settings: VideoSettings = { provider: model.provider, apiKey, model: model.modelId };
  const options: VideoOptions = deps.fetch ? { fetch: deps.fetch } : {};
  return {
    modelKey: model.modelKey,
    family: "catalog",
    modelId: model.modelId,
    capabilities: () => model.capabilities,
    ...(model.talking ? { needsActor: true } : {}),

    async createJob(req: CreateJobRequest) {
      const request = await catalogVideoRequest(model, req, deps.loadReference);
      try {
        const job = await startVideo(settings, request, { ...options, abortSignal: AbortSignal.timeout(60_000) });
        return { providerJobId: JSON.stringify(job.operation) };
      } catch (error) {
        const code = (error as { code?: string }).code;
        throw new AdapterError(
          ERROR_CODE[code ?? ""] ?? "PROVIDER_HTTP",
          error instanceof Error && error.message ? error.message : "The provider refused the render.",
        );
      }
    },

    async getJob(providerJobId: string): Promise<ProviderJobStatus> {
      const status = await checkVideo(
        settings,
        { operation: JSON.parse(providerJobId) },
        { ...options, abortSignal: AbortSignal.timeout(30_000) },
      );
      if (status.status === "pending") return { kind: "pending" };
      if (status.status === "error")
        return {
          kind: "failed",
          providerJobId,
          eventType: "job.failed",
          errorCode: "PROVIDER_FAILED",
          detail: status.message.slice(0, 300) || "The provider reported the render as failed.",
        };
      const video = status.videos[0];
      if (!video || !("url" in video))
        return {
          kind: "failed",
          providerJobId,
          eventType: "job.failed",
          errorCode: "NO_VIDEO_RETURNED",
          detail: "The provider finished without returning a video address.",
        };
      return {
        kind: "completed",
        providerJobId,
        eventType: "job.completed",
        outputUrl: video.url,
        ...(status.costUsd != null ? { costUsd: status.costUsd } : {}),
      };
    },

    downloadResult: (url: string) => downloadCatalogVideo(model.provider, apiKey, url),

    async testConnection(): Promise<ConnectionReport> {
      return testVideoKey(settings, options);
    },
  };
}
