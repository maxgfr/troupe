import { z } from "zod";

import { framesFor, sizeFor, type FrameRule } from "~/modules/models/geometry";
import { randomHex } from "~/modules/models/random";
import {
  AdapterError,
  validateRequest,
  type ConnectionReport,
  type JobOutcome,
  type ModelCapabilities,
  type VideoProviderAdapter,
} from "../../adapter";
import { videoBytes } from "../download";
import { LOCAL_DOWNLOAD_LIMIT } from "../http-endpoint";
import { bindWorkflow, type ApiWorkflow, type NodeBinding } from "./bindings";

export interface RequiredFile {
  // ComfyUI models/ subfolder, e.g. "diffusion_models".
  folder: string;
  filename: string;
  url?: string;
  // The loader node and input that lists this file in /object_info.
  nodeClass: string;
  input: string;
}

export interface ComfyModel {
  modelKey: string;
  label: string;
  baseUrl: string;
  token?: string;
  workflow: ApiWorkflow;
  bindings: NodeBinding[];
  capabilities: ModelCapabilities;
  fps: number;
  frameRule: FrameRule;
  sizeTable?: Record<string, [number, number]>;
  sizeMultiple?: number;
  negativePrompt?: string;
  // Prefer this node's output when several nodes save files.
  outputNodeId?: string;
  requiredFiles?: RequiredFile[];
  vramGb?: number;
  maxDownloadBytes?: number;
}

const FileRef = z.object({
  filename: z.string(),
  subfolder: z.string().optional().default(""),
  type: z.string().optional().default("output"),
});
const HistoryEntry = z.object({
  outputs: z.record(z.record(z.unknown())).optional().default({}),
  status: z
    .object({
      status_str: z.string().optional(),
      completed: z.boolean().optional(),
      messages: z.array(z.unknown()).optional(),
    })
    .optional(),
});
const Queue = z.object({
  queue_running: z.array(z.array(z.unknown())).default([]),
  queue_pending: z.array(z.array(z.unknown())).default([]),
});

function excerpt(text: unknown): string | null {
  if (typeof text !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const clean = text
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean ? (clean.length > 200 ? `${clean.slice(0, 199)}…` : clean) : null;
}

const OUTPUT_KEYS = ["videos", "gifs", "images"] as const;

// A uniform seed in [0, 2^31): the top 31 bits of a random 32-bit word.
function randomSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0]! >>> 1;
}

// Saved files, the preferred node first. Shapes differ between ComfyUI core
// nodes and custom nodes, so look everywhere a file can be listed.
function outputFiles(outputs: Record<string, Record<string, unknown>>, preferred?: string) {
  const ids = Object.keys(outputs).sort((a, b) => (a === preferred ? -1 : b === preferred ? 1 : 0));
  const files: z.infer<typeof FileRef>[] = [];
  for (const id of ids) {
    for (const key of OUTPUT_KEYS) {
      const list = outputs[id]![key];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const parsed = FileRef.safeParse(item);
        if (parsed.success) files.push(parsed.data);
      }
    }
  }
  return files;
}

function executionError(messages: unknown[] | undefined): string | null {
  for (const m of messages ?? []) {
    if (Array.isArray(m) && m[0] === "execution_error" && typeof m[1] === "object" && m[1]) {
      const info = m[1] as { exception_message?: unknown; node_type?: unknown };
      const said = excerpt(info.exception_message);
      return said ? `${typeof info.node_type === "string" ? `${info.node_type}: ` : ""}${said}` : null;
    }
  }
  return null;
}

// Files a loader input offers, from /object_info. Older ComfyUI lists them as
// [[...files]], newer as ["COMBO", { options: [...] }].
function comboOptions(spec: unknown): string[] | null {
  if (!Array.isArray(spec)) return null;
  if (Array.isArray(spec[0])) return spec[0].filter((x): x is string => typeof x === "string");
  if (
    spec[0] === "COMBO" &&
    typeof spec[1] === "object" &&
    spec[1] &&
    Array.isArray((spec[1] as { options?: unknown }).options)
  ) {
    return (spec[1] as { options: unknown[] }).options.filter((x): x is string => typeof x === "string");
  }
  return null;
}

export function createComfyAdapter(deps: { model: ComfyModel; fetch?: typeof fetch }): VideoProviderAdapter {
  const { model } = deps;
  const doFetch = deps.fetch ?? fetch;
  const origin = new URL(model.baseUrl).origin;
  const headers = (extra: Record<string, string> = {}) => ({
    ...extra,
    ...(model.token ? { authorization: `Bearer ${model.token}` } : {}),
  });

  async function call(path: string, init: RequestInit & { timeoutMs?: number } = {}) {
    try {
      return await doFetch(`${model.baseUrl}${path}`, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
      });
    } catch {
      throw new AdapterError(
        "LOCAL_UNREACHABLE",
        `Could not reach ComfyUI at ${origin}. Is it running and reachable from Troupe?`,
      );
    }
  }

  async function history(promptId: string) {
    const res = await call(`/history/${encodeURIComponent(promptId)}`, { headers: headers() });
    if (!res.ok) throw new Error(`ComfyUI history returned HTTP ${res.status}.`);
    const body = z.record(z.unknown()).parse(await res.json());
    return body[promptId] === undefined ? null : HistoryEntry.parse(body[promptId]);
  }

  async function inQueue(promptId: string) {
    const res = await call("/queue", { headers: headers() });
    if (!res.ok) throw new Error(`ComfyUI queue returned HTTP ${res.status}.`);
    const queue = Queue.parse(await res.json());
    return [...queue.queue_running, ...queue.queue_pending].some((item) => item[1] === promptId);
  }

  function outcome(promptId: string, entry: z.infer<typeof HistoryEntry>): JobOutcome | null {
    const fail = (errorCode: string, detail: string): JobOutcome => ({
      kind: "failed",
      providerJobId: promptId,
      eventType: "comfyui.failed",
      errorCode,
      detail,
    });
    if (entry.status?.status_str === "error") {
      const said = executionError(entry.status.messages);
      return fail(
        "COMFY_EXECUTION_ERROR",
        said ? `ComfyUI stopped: ${said}` : "ComfyUI stopped with an error. Check its console.",
      );
    }
    const files = outputFiles(entry.outputs, model.outputNodeId);
    if (files.length === 0)
      return entry.status?.completed
        ? fail(
            "NO_VIDEO_RETURNED",
            "The workflow finished without saving a file. Make sure it ends with a video save node.",
          )
        : null;
    const mp4 = files.find((f) => f.filename.toLowerCase().endsWith(".mp4"));
    if (!mp4) {
      const ext = files[0]!.filename.split(".").pop() ?? "unknown";
      return fail(
        "COMFY_UNSUPPORTED_OUTPUT",
        `The workflow saved a .${ext} file. Troupe needs an H.264 MP4: set the save node's format to mp4 (Save Video, or Video Combine with video/h264-mp4).`,
      );
    }
    const query = new URLSearchParams({ filename: mp4.filename, subfolder: mp4.subfolder, type: mp4.type });
    return {
      kind: "completed",
      providerJobId: promptId,
      eventType: "comfyui.completed",
      outputUrl: `${model.baseUrl}/view?${query.toString()}`,
    };
  }

  return {
    modelKey: model.modelKey,
    family: "comfyui",
    modelId: model.label,
    capabilities: () => model.capabilities,
    async createJob(req) {
      validateRequest(model.capabilities, req);
      const { width, height } = sizeFor(req.aspectRatio, req.resolution, {
        multiple: model.sizeMultiple,
        table: model.sizeTable,
      });
      const prompt = bindWorkflow(model.workflow, model.bindings, {
        prompt: req.prompt,
        negative_prompt: model.negativePrompt ?? "",
        width,
        height,
        frames: framesFor(req.durationS, model.fps, model.frameRule),
        fps: model.fps,
        duration_s: req.durationS,
        seed: randomSeed(),
        audio: req.audio,
        filename_prefix: `troupe/${randomHex(6)}`,
      });
      const res = await call("/prompt", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({ prompt, client_id: "troupe" }),
      });
      const body = (await res.json().catch(() => null)) as {
        prompt_id?: unknown;
        error?: { message?: unknown };
      } | null;
      if (res.status === 401 || res.status === 403)
        throw new AdapterError("LOCAL_AUTH", `ComfyUI refused the token (HTTP ${res.status}).`);
      if (!res.ok || typeof body?.prompt_id !== "string") {
        const said = excerpt(body?.error?.message);
        throw new AdapterError(
          "COMFY_REJECTED",
          `ComfyUI rejected the workflow${said ? `: ${said}` : ` (HTTP ${res.status})`}. Use Test in Settings to find missing nodes or model files.`,
        );
      }
      return { providerJobId: body.prompt_id };
    },
    async getJob(promptId) {
      const entry = await history(promptId);
      if (entry) return outcome(promptId, entry) ?? { kind: "pending" };
      if (await inQueue(promptId)) return { kind: "pending" };
      // It may have finished between the two calls.
      const late = await history(promptId);
      if (late) return outcome(promptId, late) ?? { kind: "pending" };
      return {
        kind: "failed",
        providerJobId: promptId,
        eventType: "comfyui.lost",
        errorCode: "COMFY_JOB_LOST",
        detail: "ComfyUI no longer knows this job; it was probably restarted. Launch it again.",
      };
    },
    async downloadResult(url) {
      const target = new URL(url);
      if (target.origin !== origin || target.pathname !== `${new URL(model.baseUrl).pathname.replace(/\/$/, "")}/view`)
        throw new Error(`Refusing to download a file outside ${origin}/view.`);
      let response: Response;
      try {
        response = await doFetch(target, {
          headers: headers(),
          redirect: "error",
          signal: AbortSignal.timeout(10 * 60_000),
        });
      } catch {
        throw new Error("Could not download the video from ComfyUI; it will be retried.");
      }
      return videoBytes(response, model.maxDownloadBytes ?? LOCAL_DOWNLOAD_LIMIT);
    },
    async testConnection(): Promise<ConnectionReport> {
      let stats: Response;
      try {
        stats = await call("/system_stats", { headers: headers(), timeoutMs: 10_000 });
      } catch (error) {
        return { ok: false, message: (error as Error).message };
      }
      if (!stats.ok) return { ok: false, message: `ComfyUI answered HTTP ${stats.status} at /system_stats.` };
      const system = z
        .object({
          system: z.object({ comfyui_version: z.string().optional() }).passthrough().optional(),
          devices: z
            .array(
              z
                .object({ name: z.string().optional(), type: z.string().optional(), vram_total: z.number().optional() })
                .passthrough(),
            )
            .optional(),
        })
        .safeParse(await stats.json().catch(() => null));
      const device = system.success ? system.data.devices?.[0] : undefined;
      const vramGb = device?.vram_total ? device.vram_total / 1024 ** 3 : null;
      const version = system.success ? system.data.system?.comfyui_version : undefined;
      const details: string[] = [];
      if (model.vramGb && vramGb !== null && vramGb < model.vramGb)
        details.push(
          `This workflow wants about ${model.vramGb} GB of VRAM; ${device?.name ?? "the GPU"} has ${vramGb.toFixed(1)} GB.`,
        );

      const info = await call("/object_info", { headers: headers(), timeoutMs: 60_000 }).catch(() => null);
      if (!info?.ok) return { ok: false, message: "ComfyUI is reachable but /object_info failed.", details };
      const nodes = z
        .record(
          z
            .object({
              input: z
                .object({ required: z.record(z.unknown()).optional(), optional: z.record(z.unknown()).optional() })
                .passthrough()
                .optional(),
            })
            .passthrough(),
        )
        .parse(await info.json());
      const missingNodes = [...new Set(Object.values(model.workflow).map((n) => n.class_type))].filter(
        (c) => !nodes[c],
      );
      for (const c of missingNodes)
        details.push(`Missing node: ${c}. Install or update the custom node pack that provides it, or update ComfyUI.`);
      let missingFiles = 0;
      for (const file of model.requiredFiles ?? []) {
        const spec =
          nodes[file.nodeClass]?.input?.required?.[file.input] ?? nodes[file.nodeClass]?.input?.optional?.[file.input];
        const options = comboOptions(spec);
        if (options && !options.includes(file.filename)) {
          missingFiles++;
          details.push(
            `Missing model file: models/${file.folder}/${file.filename}${file.url ? ` — download: ${file.url}` : ""}`,
          );
        }
      }
      const where = `ComfyUI${version ? ` ${version}` : ""}${device?.name ? ` on ${device.name}` : ""}${vramGb !== null ? ` (${vramGb.toFixed(1)} GB)` : ""}`;
      if (missingNodes.length || missingFiles)
        return { ok: false, message: `${where} is reachable, but this workflow cannot run yet.`, details };
      return { ok: true, message: `${where} has every node and model file this workflow needs.`, details };
    },
  };
}
