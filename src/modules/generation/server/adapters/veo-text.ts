import { z } from "zod";
import { videoBytes } from "./download";
import { AdapterError, validateRequest, type HttpLike, type ModelCapabilities, type VideoProviderAdapter } from "../adapter";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const Operation = z.object({
  name: z.string(),
  done: z.boolean().optional(),
  error: z.object({ code: z.union([z.string(), z.number()]), message: z.string().optional() }).optional(),
  response: z.object({
    generateVideoResponse: z.object({
      generatedSamples: z.array(z.object({ video: z.object({ uri: z.string().url() }) })).optional(),
      raiMediaFilteredCount: z.number().optional(),
    }).optional(),
  }).optional(),
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
      if (res.status === 401 || res.status === 403) throw new AdapterError("PROVIDER_AUTH", "Google rejected the API key, or this model is not enabled for it.");
      if (res.status === 429) throw new AdapterError("PROVIDER_QUOTA", "Google's quota for this key is exhausted. Try again later.");
      if (!res.ok) throw new AdapterError("PROVIDER_HTTP", `Google returned HTTP ${res.status}. Check your API key and quota.`);
      const operation = Operation.parse(await res.json());
      return { providerJobId: operation.name };
    },
    async getJob(name) {
      if (!/^(?:models\/[a-zA-Z0-9._-]+\/)?operations\/[a-zA-Z0-9._-]+$/.test(name)) throw new Error("Invalid provider operation.");
      const res = await deps.http(`${BASE}/${name}`, { headers: { "x-goog-api-key": deps.apiKey } });
      if (!res.ok) throw new Error(`Video status returned HTTP ${res.status}.`);
      const operation = Operation.parse(await res.json());
      if (!operation.done) return { kind: "pending" };
      if (operation.error) return { kind: "failed", providerJobId: name, eventType: "operation.failed", errorCode: `PROVIDER_${operation.error.code}`, detail: "Google reported the render as failed." };
      const response = operation.response?.generateVideoResponse;
      const uri = response?.generatedSamples?.[0]?.video.uri;
      if (!uri) {
        return {
          kind: "failed", providerJobId: name, eventType: "operation.failed", errorCode: "NO_VIDEO_RETURNED",
          detail: response?.raiMediaFilteredCount ? "Google's safety filters blocked this video. Rephrase the script and try again." : "Google finished without returning a video.",
        };
      }
      return { kind: "completed", providerJobId: name, eventType: "operation.completed", outputUrl: uri };
    },
    async downloadResult(url) {
      // Only the provider's file endpoint may receive the private API key.
      // Follow its signed storage redirect without forwarding the key.
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.hostname !== "generativelanguage.googleapis.com" || parsed.port || parsed.username || parsed.password || !parsed.pathname.startsWith("/v1beta/files/")) {
        throw new Error("Unrecognized video download address.");
      }
      let response = await fetch(url, { headers: { "x-goog-api-key": deps.apiKey }, redirect: "manual", signal: AbortSignal.timeout(60_000) });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error("Video download redirect is missing.");
        const target = new URL(location, url);
        if (target.protocol !== "https:" || target.port || target.username || target.password || !(target.hostname === "storage.googleapis.com" || target.hostname.endsWith(".googleusercontent.com"))) {
          throw new Error("Unrecognized video storage address.");
        }
        response = await fetch(target, { redirect: "error", signal: AbortSignal.timeout(60_000) });
      }
      return videoBytes(response);
    },
    async testConnection() {
      // Reading the model's metadata proves the key works and can see the
      // model, without generating anything.
      const res = await deps.http(`${BASE}/models/${model.modelId}`, { headers: { "x-goog-api-key": deps.apiKey } });
      if (res.ok) return { ok: true, message: `The key can reach ${model.modelId}.` };
      if (res.status === 400 || res.status === 401 || res.status === 403) return { ok: false, message: "Google rejected this API key." };
      if (res.status === 404) return { ok: false, message: `${model.modelId} is not available to this key.` };
      return { ok: false, message: `Google returned HTTP ${res.status}. Try again later.` };
    },
  };
}
