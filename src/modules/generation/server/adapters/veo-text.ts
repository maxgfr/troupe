import { z } from "zod";
import { videoBytes } from "./download";
import { googleError, PROBLEM_CODE } from "./provider-errors";
import {
  AdapterError,
  validateRequest,
  type HttpLike,
  type ModelCapabilities,
  type VideoProviderAdapter,
} from "../adapter";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const Operation = z.object({
  name: z.string(),
  done: z.boolean().optional(),
  error: z.object({ code: z.union([z.string(), z.number()]), message: z.string().optional() }).optional(),
  response: z
    .object({
      generateVideoResponse: z
        .object({
          generatedSamples: z.array(z.object({ video: z.object({ uri: z.string().url() }) })).optional(),
          raiMediaFilteredCount: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
});

export interface VeoModel {
  modelKey: string;
  // Gemini API model id, e.g. "veo-3.1-fast-generate-preview".
  modelId: string;
  capabilities: ModelCapabilities;
}

// Gemini API long-running video generation, text-only. REST contract checked
// against https://ai.google.dev/gemini-api/docs/veo (2026-09-13).
export function createVeoTextAdapter(deps: { model: VeoModel; http: HttpLike; apiKey: string }): VideoProviderAdapter {
  const { model } = deps;
  return {
    modelKey: model.modelKey,
    family: "veo",
    modelId: model.modelId,
    capabilities: () => model.capabilities,
    async createJob(req) {
      validateRequest(model.capabilities, req);
      const res = await deps.http(`${BASE}/models/${model.modelId}:predictLongRunning`, {
        method: "POST",
        headers: { "x-goog-api-key": deps.apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          instances: [{ prompt: req.prompt }],
          parameters: { aspectRatio: req.aspectRatio, durationSeconds: req.durationS, resolution: req.resolution },
        }),
      });
      if (!res.ok) {
        const error = googleError(res.status, await res.json().catch(() => null));
        throw new AdapterError(PROBLEM_CODE[error.problem], error.message);
      }
      const operation = Operation.parse(await res.json());
      return { providerJobId: operation.name };
    },
    async getJob(name) {
      if (!/^(?:models\/[a-zA-Z0-9._-]+\/)?operations\/[a-zA-Z0-9._-]+$/.test(name))
        throw new Error("Invalid provider operation.");
      const res = await deps.http(`${BASE}/${name}`, { headers: { "x-goog-api-key": deps.apiKey } });
      if (!res.ok) throw new Error(`Video status returned HTTP ${res.status}.`);
      const operation = Operation.parse(await res.json());
      if (!operation.done) return { kind: "pending" };
      if (operation.error)
        return {
          kind: "failed",
          providerJobId: name,
          eventType: "operation.failed",
          errorCode: `PROVIDER_${operation.error.code}`,
          detail: "Google reported the render as failed.",
        };
      const response = operation.response?.generateVideoResponse;
      const uri = response?.generatedSamples?.[0]?.video.uri;
      if (!uri) {
        return {
          kind: "failed",
          providerJobId: name,
          eventType: "operation.failed",
          errorCode: "NO_VIDEO_RETURNED",
          detail: response?.raiMediaFilteredCount
            ? "Google's safety filters blocked this video. Rephrase the script and try again."
            : "Google finished without returning a video.",
        };
      }
      return { kind: "completed", providerJobId: name, eventType: "operation.completed", outputUrl: uri };
    },
    async downloadResult(url) {
      // Only the provider's file endpoint may receive the private API key.
      // Follow its signed storage redirect without forwarding the key.
      const parsed = new URL(url);
      if (
        parsed.protocol !== "https:" ||
        parsed.hostname !== "generativelanguage.googleapis.com" ||
        parsed.port ||
        parsed.username ||
        parsed.password ||
        !parsed.pathname.startsWith("/v1beta/files/")
      ) {
        throw new Error("Unrecognized video download address.");
      }
      let response = await fetch(url, {
        headers: { "x-goog-api-key": deps.apiKey },
        redirect: "manual",
        signal: AbortSignal.timeout(60_000),
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error("Video download redirect is missing.");
        const target = new URL(location, url);
        if (
          target.protocol !== "https:" ||
          target.port ||
          target.username ||
          target.password ||
          !(target.hostname === "storage.googleapis.com" || target.hostname.endsWith(".googleusercontent.com"))
        ) {
          throw new Error("Unrecognized video storage address.");
        }
        response = await fetch(target, { redirect: "error", signal: AbortSignal.timeout(60_000) });
      }
      return videoBytes(response);
    },
    async testConnection() {
      // Reading the model's metadata is free: it proves the key works and
      // that Google offers it this model, without generating anything.
      const res = await deps.http(`${BASE}/models/${model.modelId}`, { headers: { "x-goog-api-key": deps.apiKey } });
      if (res.ok) {
        return {
          ok: true,
          message: `The key works and can use ${model.modelId}. Veo bills each second of video and needs a paid (billing-enabled) Gemini API project.`,
        };
      }
      const error = googleError(res.status, await res.json().catch(() => null));
      return {
        ok: false,
        message:
          error.problem === "not-found"
            ? `The key works, but Google does not offer ${model.modelId} to it.`
            : error.message,
      };
    },
  };
}
