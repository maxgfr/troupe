import { z } from "zod";
import { AdapterError, validateRequest, type HttpLike, type ModelCapabilities, type VideoProviderAdapter } from "../adapter";
import { downloadFalVideo } from "./download";

const Request = z.object({ request_id: z.string(), status_url: z.string().url(), response_url: z.string().url() });

// Follow the URLs returned by fal's queue instead of guessing model-specific
// status paths. The private key is only sent to queue.fal.run.
function queueUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "queue.fal.run" || url.port || url.username || url.password) throw new Error("Invalid fal queue address.");
  return value;
}

export interface FalModel {
  modelKey: string;
  // fal endpoint path, e.g. "fal-ai/kling-video/v3/standard/text-to-video".
  endpoint: string;
  capabilities: ModelCapabilities;
  // Whether the endpoint takes a `resolution` parameter.
  sendsResolution: boolean;
}

export function createFalAdapter(deps: { model: FalModel; apiKey: string; http: HttpLike }): VideoProviderAdapter {
  const { model } = deps;
  const headers = { authorization: `Key ${deps.apiKey}`, "content-type": "application/json" };
  return {
    modelKey: model.modelKey,
    family: "fal",
    modelId: model.endpoint,
    capabilities: () => model.capabilities,
    async createJob(req) {
      validateRequest(model.capabilities, req);
      const response = await deps.http(`https://queue.fal.run/${model.endpoint}`, {
        method: "POST", headers,
        body: JSON.stringify({
          prompt: req.prompt,
          aspect_ratio: req.aspectRatio,
          duration: String(req.durationS),
          generate_audio: req.audio,
          ...(model.sendsResolution ? { resolution: req.resolution } : {}),
        }),
      });
      if (response.status === 401 || response.status === 403) throw new AdapterError("PROVIDER_AUTH", "fal.ai rejected the API key. Check it in Settings.");
      if (!response.ok) throw new AdapterError("PROVIDER_HTTP", `fal.ai returned HTTP ${response.status}. Check your key and balance.`);
      const request = Request.parse(await response.json());
      queueUrl(request.status_url); queueUrl(request.response_url);
      return { providerJobId: JSON.stringify(request) };
    },
    async getJob(providerJobId) {
      const request = Request.parse(JSON.parse(providerJobId));
      const response = await deps.http(queueUrl(request.status_url), { headers });
      if (!response.ok) throw new Error(`Video status returned HTTP ${response.status}.`);
      const status = z.object({ status: z.enum(["IN_QUEUE", "IN_PROGRESS", "COMPLETED"]), error: z.string().nullish() }).parse(await response.json());
      if (status.status !== "COMPLETED") return { kind: "pending" };
      if (status.error) return { kind: "failed", providerJobId, eventType: "queue.failed", errorCode: "PROVIDER_FAILED", detail: "fal.ai reported the render as failed." };
      const result = await deps.http(queueUrl(request.response_url), { headers });
      if (result.status === 422 || result.status === 400) return { kind: "failed", providerJobId, eventType: "queue.failed", errorCode: "PROVIDER_REJECTED", detail: "fal.ai rejected the request, often because of its content policy." };
      if (!result.ok) throw new Error("Video result temporarily unavailable.");
      const output = z.object({ video: z.object({ url: z.string().url() }) }).safeParse(await result.json());
      if (!output.success) return { kind: "failed", providerJobId, eventType: "queue.failed", errorCode: "NO_VIDEO_RETURNED", detail: "fal.ai finished without returning a video." };
      return { kind: "completed", providerJobId, eventType: "queue.completed", outputUrl: output.data.video.url };
    },
    downloadResult: downloadFalVideo,
  };
}
