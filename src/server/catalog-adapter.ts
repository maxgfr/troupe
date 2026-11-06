import { checkVideo, startVideo, testVideoKey, type VideoOptions, type VideoSettings } from "llm-connect/video";

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
}): VideoProviderAdapter {
  const { model, apiKey } = deps;
  const settings: VideoSettings = { provider: model.provider, apiKey, model: model.modelId };
  const options: VideoOptions = deps.fetch ? { fetch: deps.fetch } : {};
  return {
    modelKey: model.modelKey,
    family: "catalog",
    modelId: model.modelId,
    capabilities: () => model.capabilities,

    async createJob(req: CreateJobRequest) {
      try {
        const job = await startVideo(
          settings,
          {
            prompt: req.prompt,
            aspectRatio: req.aspectRatio,
            resolution: req.resolution,
            durationS: req.durationS,
            // Only a model that offers the choice is told; the others keep their own.
            ...(model.capabilities.audio === "optional" ? { audio: req.audio } : {}),
          },
          { ...options, abortSignal: AbortSignal.timeout(60_000) },
        );
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
