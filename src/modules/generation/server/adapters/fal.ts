import { z } from "zod";
import { AdapterError, validateRequest, type HttpLike, type ModelCapabilities, type VideoProviderAdapter } from "../adapter";
import { downloadFalVideo } from "./download";
import { falError, PROBLEM_CODE } from "./provider-errors";

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
  // The longest prompt the endpoint takes, in characters.
  promptMaxChars?: number;
}

// fal's platform API: pricing needs a valid key and costs nothing.
const PLATFORM = "https://api.fal.ai/v1";
const Pricing = z.object({ prices: z.array(z.object({ endpoint_id: z.string(), unit_price: z.number(), unit: z.string(), currency: z.string() })) });

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
      if (model.promptMaxChars && req.prompt.length > model.promptMaxChars) {
        throw new AdapterError("PROMPT_TOO_LONG", `This model takes prompts of up to ${model.promptMaxChars} characters; this one has ${req.prompt.length}. Shorten the script.`);
      }
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
      if (!response.ok) {
        const error = falError(response.status, await response.json().catch(() => null));
        throw new AdapterError(PROBLEM_CODE[error.problem], error.message);
      }
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
    async testConnection() {
      // Reading the endpoint's price is free and refuses an unknown key.
      const res = await deps.http(`${PLATFORM}/models/pricing?endpoint_id=${encodeURIComponent(model.endpoint)}`, { headers: { authorization: `Key ${deps.apiKey}` } });
      if (!res.ok) return { ok: false, message: falError(res.status, await res.json().catch(() => null)).message };
      const price = Pricing.safeParse(await res.json()).data?.prices.find((p) => p.endpoint_id === model.endpoint);
      if (!price) return { ok: true, message: `The key works. fal.ai lists no price for ${model.endpoint}; check it on fal.ai before launching.` };
      return {
        ok: true,
        message: `The key works. fal.ai bills ${model.endpoint} at ${price.currency === "USD" ? "$" : `${price.currency} `}${price.unit_price} per ${price.unit}, from the account's balance.`,
      };
    },
  };
}
