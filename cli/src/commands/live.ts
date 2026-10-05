import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { promisify } from "node:util";

import { fetchMedia, type Outputs } from "../client.ts";
import { type Context, type OptionValues, str, strings } from "../command.ts";
import { usageError } from "../errors.ts";
import { pick } from "../resolve.ts";
import { watchRender } from "./render.ts";

// `troupe doctor --live`: one real render per model, at the cheapest settings
// each one offers, through the studio's own API (launch, background checks,
// storage, download), then ffprobe on the downloaded file. Paid models bill
// their provider account: the plan and its estimate come first, and nothing
// is launched without --yes.

type Model = Outputs["settings"]["models"]["list"]["models"][number];

// Lowest first; anything else sorts after these.
const RESOLUTIONS = ["240p", "360p", "480p", "540p", "576p", "720p", "1080p", "4k"];
const rank = (resolution: string) => {
  const at = RESOLUTIONS.indexOf(resolution);
  return at === -1 ? RESOLUTIONS.length : at;
};

export interface LivePlan {
  modelKey: string;
  label: string;
  kind: "cloud" | "local";
  durationS: number;
  resolution: string;
  audio: boolean;
  // Null: the model has no price set.
  estimateUsd: number | null;
}

// The shortest clip at the lowest resolution, silent where the model allows.
export function cheapestPlan(model: Pick<Model, "key" | "label" | "kind" | "capabilities" | "pricePerSecondUsd">): LivePlan {
  const durationS = Math.min(...model.capabilities.durationsS);
  const resolution = [...model.capabilities.resolutions].sort((a, b) => rank(a) - rank(b))[0]!;
  const price = model.pricePerSecondUsd;
  return {
    modelKey: model.key,
    label: model.label,
    kind: model.kind,
    durationS,
    resolution,
    audio: model.capabilities.audio === "always",
    estimateUsd: price === null ? (model.kind === "local" ? 0 : null) : Math.round(price * durationS * 100) / 100,
  };
}

export function planTotal(plans: LivePlan[]): { usd: number; unknown: string[] } {
  return {
    usd: Math.round(plans.reduce((sum, p) => sum + (p.estimateUsd ?? 0), 0) * 100) / 100,
    unknown: plans.filter((p) => p.estimateUsd === null).map((p) => p.label),
  };
}

export const money = (usd: number | null) => (usd === null ? "price unknown" : usd === 0 ? "free" : `about $${usd.toFixed(2)}`);

// --model picks some; otherwise every model that can launch.
export async function livePlans(ctx: Context, options: OptionValues): Promise<LivePlan[]> {
  const { models } = await ctx.api.settings.models.list.query();
  const ready = models.filter((m) => m.status === "ready" && m.enabled && !m.archived);
  const refs = strings(options, "model");
  const chosen = refs.length
    ? refs.map((ref) => pick(models, ref, { kind: "model", listCommand: "troupe models list", id: (m) => m.key, names: (m) => [m.label] }))
    : ready;
  for (const m of chosen) if (!ready.includes(m)) throw usageError(`${m.label} cannot launch now (${m.statusDetail ?? m.status}). Pick another with --model.`);
  return chosen.map(cheapestPlan);
}

export interface LiveResult extends LivePlan {
  renderId: string | null;
  status: "completed" | "failed" | "not launched";
  detail: string;
  file: string | null;
  probe: { codec: string; width: number; height: number; durationS: number } | null;
}

const run = promisify(execFile);

async function ffprobe(file: string, env: Record<string, string | undefined>) {
  try {
    const { stdout } = await run(env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height:format=duration", "-of", "json", file], { timeout: 30_000 });
    const out = JSON.parse(stdout) as { streams?: { codec_name: string; width: number; height: number }[]; format?: { duration?: string } };
    const s = out.streams?.[0];
    const durationS = Number(out.format?.duration);
    return s && Number.isFinite(durationS) ? { codec: s.codec_name, width: s.width, height: s.height, durationS } : null;
  } catch {
    return null;
  }
}

async function save(ctx: Context, path: string, target: string) {
  const response = await fetchMedia(ctx.connection, path);
  if (!response.ok || !response.body) throw new Error(`the studio answered HTTP ${response.status}`);
  const partial = `${target}.part`;
  try {
    await pipeline(Readable.fromWeb(response.body as WebReadableStream<Uint8Array>), createWriteStream(partial));
    await rename(partial, target);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}

// A script short enough for a 2 s clip.
const SCRIPT = { text: "Hi! Try this.", emotion: "happy" } as const;

export async function runLive(ctx: Context, plans: LivePlan[], options: OptionValues): Promise<{ projectId: string; folder: string; results: LiveResult[]; chat: { ok: boolean; detail: string } }> {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const folder = resolve(ctx.io.cwd, str(options, "output") ?? `troupe-live-${stamp}`);
  await mkdir(folder, { recursive: true });
  const actor = (await ctx.api.actors.list.query())[0];
  if (!actor) throw usageError("The studio has no actor to cast. Open it once so it seeds its actors.");
  const project = await ctx.api.studio.createFromWizard.mutate({ workspaceId: await ctx.workspaceId(), title: `Live check ${stamp}`, platform: "tiktok", format: "9:16", language: "en", actorId: actor.id });
  const script = await ctx.api.script.paste.mutate({ projectId: project.id, text: SCRIPT.text, emotions: [SCRIPT.emotion] });
  ctx.note(`Project "${project.title}" (${project.id}) holds the renders; delete it with troupe projects delete when done.`);

  // Launch everything first: the providers work in parallel.
  const launched: { plan: LivePlan; renderId: string | null; error: string | null }[] = [];
  for (const plan of plans) {
    try {
      const render = await ctx.api.generation.launchText.mutate({ projectId: project.id, scriptId: script.id, modelKey: plan.modelKey, durationS: plan.durationS, resolution: plan.resolution, audio: plan.audio, language: "en" });
      ctx.note(`Launched ${plan.label}: ${plan.durationS} s, ${plan.resolution}${plan.audio ? ", with audio" : ", silent"} (${money(plan.estimateUsd)}).`);
      launched.push({ plan, renderId: render.id, error: null });
    } catch (error) {
      launched.push({ plan, renderId: null, error: (error as Error).message });
    }
  }

  // The chat model, once: a proposal for the same project.
  let chat: { ok: boolean; detail: string };
  try {
    const { assistant } = await ctx.api.chat.send.mutate({ projectId: project.id, message: "Make it a little warmer.", durationS: Math.max(4, ...plans.map((p) => p.durationS)) });
    chat = { ok: Boolean(assistant.proposal), detail: `${assistant.provider ?? "chat"} (${assistant.model ?? "?"}) ${assistant.proposal ? "proposed a script" : "answered without a script"}.` };
  } catch (error) {
    chat = { ok: false, detail: (error as Error).message };
  }

  const timeout = str(options, "timeout") ?? "1800";
  const results: LiveResult[] = [];
  for (const { plan, renderId, error } of launched) {
    if (!renderId) {
      results.push({ ...plan, renderId: null, status: "not launched", detail: error ?? "", file: null, probe: null });
      continue;
    }
    let render: Awaited<ReturnType<typeof watchRender>>["render"];
    try {
      ({ render } = await watchRender(ctx, project.id, renderId, { interval: str(options, "interval"), timeout }));
    } catch (watchError) {
      results.push({ ...plan, renderId, status: "failed", detail: (watchError as Error).message, file: null, probe: null });
      continue;
    }
    if (render.status !== "completed" || !render.outputAssetUrl) {
      results.push({ ...plan, renderId, status: "failed", detail: render.errorDetail ?? render.errorCode ?? "no reason given", file: null, probe: null });
      continue;
    }
    const file = join(folder, `${plan.modelKey}.mp4`);
    try {
      await save(ctx, `${render.outputAssetUrl}?download=1`, file);
    } catch (saveError) {
      results.push({ ...plan, renderId, status: "failed", detail: `Rendered, but the download failed: ${(saveError as Error).message}.`, file: null, probe: null });
      continue;
    }
    const probe = await ffprobe(file, ctx.io.env);
    const bytes = (await stat(file)).size;
    results.push({
      ...plan,
      renderId,
      status: probe ? "completed" : "failed",
      detail: probe ? `${probe.codec} ${probe.width}x${probe.height}, ${probe.durationS.toFixed(2)} s, ${(bytes / 1_048_576).toFixed(1)} MB` : "Saved, but ffprobe could not read it (is ffprobe on PATH? FFPROBE_PATH sets it).",
      file,
      probe,
    });
  }
  return { projectId: project.id, folder, results, chat };
}
