import { z } from "zod";

import { sizeFor } from "~/modules/models/geometry";
import { AdapterError, clampPollEveryS, validateRequest, type ConnectionReport, type JobScript, type ModelCapabilities, type VideoProviderAdapter } from "../adapter";
import { videoBytes } from "./download";

// Contract v1 for a self-hosted video model behind plain HTTP
// (docs/LOCAL-MODELS.md):
//   GET  /health      → { ok, contract: 1, poll_every_s? }
//   POST /jobs        → { id }   (the body may carry an optional `script`)
//   GET  /jobs/{id}   → { status: queued|running|succeeded|failed, progress?, error?, video_url? }
export const HTTP_CONTRACT_VERSION = 1;
export const LOCAL_DOWNLOAD_LIMIT = 200 * 1024 * 1024;

export interface HttpEndpointModel {
  modelKey: string;
  label: string;
  // Already validated by src/server/settings/urls.ts, without a trailing slash.
  baseUrl: string;
  token?: string;
  capabilities: ModelCapabilities;
  fps?: number;
  sizeMultiple?: number;
  maxDownloadBytes?: number;
  // Polling pace learned from /health when the model was tested.
  pollEveryS?: number;
}

const Created = z.object({ id: z.union([z.string(), z.number()]).transform(String) });
const Status = z.object({
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  progress: z.number().min(0).max(1).optional(),
  error: z.unknown().optional(),
  video_url: z.string().optional(),
});
const Health = z.object({ ok: z.boolean(), contract: z.number().optional(), poll_every_s: z.unknown().optional() });

// The script as the contract spells it: snake_case, like the rest of the body.
function scriptBody(script: JobScript) {
  const { actor } = script;
  return {
    language: script.language,
    actor: { id: actor.id, name: actor.name, gender: actor.gender, age_range: actor.ageRange, voice_profile: actor.voiceProfile },
    lines: script.lines.map(({ role, text, emotion }) => ({ role, text, emotion })),
  };
}

function sameOrigin(candidate: string, base: string) {
  try {
    return new URL(candidate).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

function excerpt(text: unknown): string | null {
  if (typeof text !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return clean ? (clean.length > 200 ? `${clean.slice(0, 199)}…` : clean) : null;
}

export function createHttpEndpointAdapter(deps: { model: HttpEndpointModel; fetch?: typeof fetch }): VideoProviderAdapter {
  const { model } = deps;
  const doFetch = deps.fetch ?? fetch;
  const origin = new URL(model.baseUrl).origin;
  const headers = (extra: Record<string, string> = {}) => ({ ...extra, ...(model.token ? { authorization: `Bearer ${model.token}` } : {}) });

  async function call(path: string, init: RequestInit & { timeoutMs?: number } = {}) {
    try {
      return await doFetch(`${model.baseUrl}${path}`, { ...init, redirect: "error", signal: AbortSignal.timeout(init.timeoutMs ?? 30_000) });
    } catch {
      throw new AdapterError("LOCAL_UNREACHABLE", `Could not reach ${origin}. Is the server running and reachable from Troupe?`);
    }
  }

  function statusError(status: number): AdapterError {
    if (status === 401 || status === 403) return new AdapterError("LOCAL_AUTH", `${model.label} refused the token (HTTP ${status}). Check it in Settings.`);
    return new AdapterError("LOCAL_HTTP", `${model.label} returned HTTP ${status}.`);
  }

  const pollEveryS = clampPollEveryS(model.pollEveryS);
  return {
    modelKey: model.modelKey,
    family: "http",
    modelId: model.label,
    ...(pollEveryS ? { pollEveryS } : {}),
    capabilities: () => model.capabilities,
    async createJob(req) {
      validateRequest(model.capabilities, req);
      const { width, height } = sizeFor(req.aspectRatio, req.resolution, { multiple: model.sizeMultiple });
      const response = await call("/jobs", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          prompt: req.prompt, aspect_ratio: req.aspectRatio, resolution: req.resolution, width, height,
          duration_s: req.durationS, ...(model.fps ? { fps: model.fps } : {}), audio: req.audio,
          ...(req.script ? { script: scriptBody(req.script) } : {}),
        }),
      });
      if (!response.ok) throw statusError(response.status);
      const created = Created.safeParse(await response.json().catch(() => null));
      if (!created.success) throw new AdapterError("LOCAL_BAD_RESPONSE", `${model.label} did not return a job id. Check that it follows contract v${HTTP_CONTRACT_VERSION}.`);
      return { providerJobId: created.data.id };
    },
    async getJob(providerJobId) {
      const response = await call(`/jobs/${encodeURIComponent(providerJobId)}`, { headers: headers() });
      if (!response.ok) throw statusError(response.status);
      const status = Status.parse(await response.json());
      if (status.status === "queued" || status.status === "running") return { kind: "pending", ...(status.progress !== undefined ? { progress: status.progress } : {}) };
      if (status.status === "failed") {
        const said = excerpt(status.error);
        return { kind: "failed", providerJobId, eventType: "local.failed", errorCode: "LOCAL_JOB_FAILED", detail: said ? `${model.label} reported: ${said}` : `${model.label} reported the job as failed.` };
      }
      if (!status.video_url) return { kind: "failed", providerJobId, eventType: "local.failed", errorCode: "NO_VIDEO_RETURNED", detail: `${model.label} finished without a video_url.` };
      const outputUrl = new URL(status.video_url, `${model.baseUrl}/`).toString();
      if (!sameOrigin(outputUrl, model.baseUrl)) {
        return { kind: "failed", providerJobId, eventType: "local.failed", errorCode: "OUTPUT_FOREIGN_ORIGIN", detail: `${model.label} pointed to a video on another server; serve it from ${origin}.` };
      }
      return { kind: "completed", providerJobId, eventType: "local.completed", outputUrl };
    },
    async downloadResult(url) {
      if (!sameOrigin(url, model.baseUrl)) throw new Error(`Refusing to download a video from another origin than ${origin}.`);
      let response: Response;
      try {
        response = await doFetch(url, { headers: headers(), redirect: "error", signal: AbortSignal.timeout(10 * 60_000) });
      } catch {
        throw new Error(`Could not download the video from ${origin}; it will be retried.`);
      }
      return videoBytes(response, model.maxDownloadBytes ?? LOCAL_DOWNLOAD_LIMIT);
    },
    async testConnection(): Promise<ConnectionReport> {
      let response: Response;
      try {
        response = await call("/health", { headers: headers(), timeoutMs: 10_000 });
      } catch (error) {
        return { ok: false, message: (error as Error).message };
      }
      if (!response.ok) return { ok: false, message: statusError(response.status).detail };
      const health = Health.safeParse(await response.json().catch(() => null));
      if (!health.success || !health.data.ok) return { ok: false, message: `${origin}/health did not answer { ok: true }.` };
      if (health.data.contract !== undefined && health.data.contract !== HTTP_CONTRACT_VERSION) {
        return { ok: false, message: `The server speaks contract ${health.data.contract}; Troupe expects contract ${HTTP_CONTRACT_VERSION}.` };
      }
      const message = `${model.label} is reachable and speaks contract ${HTTP_CONTRACT_VERSION}.`;
      const pace = clampPollEveryS(health.data.poll_every_s);
      if (!pace) return { ok: true, message };
      return { ok: true, message, details: [`It asks Troupe to check on renders every ${pace} s.`], pollEveryS: pace };
    },
  };
}
