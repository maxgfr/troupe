import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { createComfyAdapter } from "~/modules/generation/server/adapters/comfyui/adapter";
import { findComfyTemplate } from "~/modules/generation/server/adapters/comfyui/templates";
import { createFalAdapter } from "~/modules/generation/server/adapters/fal";
import { createVeoTextAdapter } from "~/modules/generation/server/adapters/veo-text";
import type { HttpLike, VideoProviderAdapter } from "~/modules/generation";
import { buildChatPrompt, proposalJsonSchema, type ChatModel } from "~/modules/chat";
import { builtinModels, type BuiltinModel } from "~/modules/models";
import { CLAUDE_CHAT_ANSWER_USD, listPriceUsd } from "~/modules/models/list-price";
import { createAnthropicChat, DEFAULT_ANTHROPIC_MODEL, testAnthropic } from "~/server/chat/anthropic";
import { createOllamaChat, testOllama } from "~/server/chat/ollama";
import { claudeCapabilities } from "~/server/chat/claude-models";
import { environmentKey } from "~/server/settings/providers";

// pnpm verify:live: one real job per provider whose key or address is in the
// environment, through the same adapters the studio runs, at the cheapest
// settings each provider offers. Free checks and free jobs always run; jobs
// a provider bills (Google, fal.ai, Anthropic) only with --yes
// (TROUPE_LIVE_YES=1). Keys are never printed.

type Env = Record<string, string | undefined>;

export interface LiveCheck {
  id: "google" | "fal" | "anthropic" | "ollama" | "comfyui" | "supabase" | "studio";
  name: string;
  // What runs, e.g. "Veo 3.1 Lite, one 4 s 720p clip".
  job: string;
  // Billed by the provider: runs only with --yes, whatever its estimate.
  paid: boolean;
  // The estimated cost, as a range; null when the price is unknown.
  estimate: { lowUsd: number; highUsd: number } | null;
  // Why it does not run; null when it does.
  skip: string | null;
}

// The providers that bill each job. Decided by the provider, never by the
// price: a paid model without a known price still waits for --yes.
const PAID: ReadonlySet<LiveCheck["id"]> = new Set(["google", "fal", "anthropic"]);

const usd = (n: number) => `$${n.toFixed(2)}`;

export function describeCost(check: Pick<LiveCheck, "paid" | "estimate">): string {
  if (!check.paid) return "free";
  if (!check.estimate) return "price unknown";
  const { lowUsd, highUsd } = check.estimate;
  return lowUsd === highUsd ? `about ${usd(lowUsd)}` : `about ${usd(lowUsd)}–${highUsd.toFixed(2)}`;
}

// A paid job runs only once confirmed; free checks and free jobs always do.
export function runsNow(check: Pick<LiveCheck, "paid" | "skip">, confirmed: boolean): boolean {
  return !check.skip && (!check.paid || confirmed);
}

const FAMILY_NAME = { veo: "a Google", fal: "a fal.ai" } as const;

// TROUPE_LIVE_VEO_MODEL / TROUPE_LIVE_FAL_MODEL, which must name a built-in
// of that provider.
function builtin(models: readonly BuiltinModel[], variable: string, key: string, family: "veo" | "fal"): BuiltinModel {
  const model = models.find((m) => m.key === key);
  if (!model || model.family !== family) {
    const choices = models.filter((m) => m.family === family).map((m) => m.key).join(", ");
    throw new Error(`${variable} must name ${FAMILY_NAME[family]} model (${choices}), not "${key}".`);
  }
  return model;
}

const veoModel = (env: Env, models: readonly BuiltinModel[] = builtinModels(env)) =>
  builtin(models, "TROUPE_LIVE_VEO_MODEL", env.TROUPE_LIVE_VEO_MODEL?.trim() || "veo-3.1-lite", "veo");
const falModel = (env: Env, models: readonly BuiltinModel[] = builtinModels(env)) =>
  builtin(models, "TROUPE_LIVE_FAL_MODEL", env.TROUPE_LIVE_FAL_MODEL?.trim() || "seedance-1.5-pro", "fal");

const cheapest = (m: BuiltinModel) => ({
  durationS: Math.min(...m.capabilities.durationsS),
  // Built-ins list their resolutions lowest first.
  resolution: m.capabilities.resolutions[0]!,
  audio: m.capabilities.audio === "always",
});

const point = (value: number | null) => (value === null ? null : { lowUsd: value, highUsd: value });

export function comfyUrl(env: Env) {
  return env.TROUPE_LIVE_COMFYUI_URL?.trim() || env.COMFYUI_URL?.trim() || "";
}

export function planChecks(env: Env, models: readonly BuiltinModel[] = builtinModels(env)): LiveCheck[] {
  const veo = veoModel(env, models);
  const fal = falModel(env, models);
  const v = cheapest(veo);
  // fal's audio is optional on both built-ins: the check renders silent.
  const f = { ...cheapest(fal), audio: false };
  const claude = env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;
  const checks: Omit<LiveCheck, "paid">[] = [
    {
      id: "google", name: "Google Gemini API",
      job: `${veo.label} (${veo.modelId}), one ${v.durationS} s ${v.resolution} 9:16 clip`,
      estimate: point(listPriceUsd({ key: veo.key, kind: "cloud", pricePerSecondUsd: veo.pricePerSecondUsd }, v)),
      skip: environmentKey("google", env) ? null : "no GEMINI_API_KEY, GOOGLE_API_KEY or GOOGLE_GENAI_API_KEY",
    },
    {
      id: "fal", name: "fal.ai",
      job: `${fal.label} (${fal.modelId}), one ${f.durationS} s ${f.resolution} 9:16 clip, silent`,
      estimate: point(listPriceUsd({ key: fal.key, kind: "cloud", pricePerSecondUsd: fal.pricePerSecondUsd }, f)),
      skip: environmentKey("fal", env) ? null : "no FAL_KEY",
    },
    {
      id: "anthropic", name: "Anthropic",
      job: `${claude}, one script chat answer`,
      estimate: CLAUDE_CHAT_ANSWER_USD,
      skip: environmentKey("anthropic", env) ? null : "no ANTHROPIC_API_KEY",
    },
    {
      id: "ollama", name: "Ollama",
      job: `${env.OLLAMA_MODEL?.trim() || "qwen3:4b"}, one script chat answer`,
      estimate: null,
      skip: env.OLLAMA_URL?.trim() ? null : "no OLLAMA_URL",
    },
    {
      id: "comfyui", name: "ComfyUI",
      job: `the ${env.TROUPE_LIVE_COMFYUI_TEMPLATE?.trim() || "ltxv-2b-distilled"} template, one shortest clip`,
      estimate: null,
      skip: comfyUrl(env) ? null : "no TROUPE_LIVE_COMFYUI_URL (or COMFYUI_URL)",
    },
    {
      id: "supabase", name: "Supabase",
      job: "Storage: upload, signed download and delete of a small MP4; Postgres: migrations applied and row level security, when DATABASE_URL is set",
      estimate: null,
      skip: env.SUPABASE_URL?.trim() && env.SUPABASE_SERVICE_ROLE_KEY?.trim() ? null : "no SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    },
    {
      id: "studio", name: "Deployed studio (Vercel)",
      job: "GET /api/health, then POST /api/jobs/reconcile with RECONCILE_SECRET",
      estimate: null,
      skip: env.TROUPE_LIVE_STUDIO_URL?.trim() && env.RECONCILE_SECRET?.trim() ? null : "no TROUPE_LIVE_STUDIO_URL and RECONCILE_SECRET",
    },
  ];
  return checks.map((c) => ({ ...c, paid: PAID.has(c.id) }));
}

export function planTable(checks: LiveCheck[]): string {
  const rows = checks.map((c) => [c.skip ? "skip" : c.paid ? "paid" : "free", c.name, c.job, c.skip ? `skipped: ${c.skip}` : describeCost(c)]);
  const widths = [0, 1, 2].map((i) => Math.max(...rows.map((r) => r[i]!.length)));
  return rows.map((r) => r.map((cell, i) => (i < 3 ? cell.padEnd(widths[i]!) : cell)).join("  ")).join("\n");
}

// What the paid jobs that will run cost in all, and which have no price.
export function paidTotal(checks: LiveCheck[]): { lowUsd: number; highUsd: number; unknown: string[] } {
  const paid = checks.filter((c) => c.paid && !c.skip);
  const sum = (pick: (e: { lowUsd: number; highUsd: number }) => number) => Math.round(paid.reduce((s, c) => s + (c.estimate ? pick(c.estimate) : 0), 0) * 100) / 100;
  return { lowUsd: sum((e) => e.lowUsd), highUsd: sum((e) => e.highUsd), unknown: paid.filter((c) => !c.estimate).map((c) => c.name) };
}

// ---------------------------------------------------------------------------

export interface Probe {
  codec: string;
  width: number;
  height: number;
  durationS: number;
}

export interface Deps {
  env: Env;
  http: HttpLike;
  fetch: typeof fetch;
  outDir: string;
  ffprobe(file: string): Promise<Probe>;
  sleep(ms: number): Promise<void>;
  log(line: string): void;
}

const run = promisify(execFile);

// The studio's HTTP client for adapters (src/server/adapters.ts), without
// its server-only imports.
export const liveHttp: HttpLike = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  return { ok: res.ok, status: res.status, json: () => res.json() as Promise<unknown> };
};

export async function ffprobeFile(file: string, env: Env = process.env): Promise<Probe> {
  const { stdout } = await run(env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height:format=duration", "-of", "json", file], { timeout: 30_000 });
  const out = JSON.parse(stdout) as { streams?: { codec_name: string; width: number; height: number }[]; format?: { duration?: string } };
  const stream = out.streams?.[0];
  const durationS = Number(out.format?.duration);
  if (!stream || !Number.isFinite(durationS)) throw new Error(`ffprobe found no video in ${file}.`);
  return { codec: stream.codec_name, width: stream.width, height: stream.height, durationS };
}

const PROMPT = "UGC-style ad, single actor speaking to camera in a bright kitchen. Voice: warm, mid-tempo. Language: en.\nDialogue:\n[happy] (hook) Hi! Try this.";

// Create, poll, download, ffprobe: the studio's path for one render.
export async function renderOnce(adapter: VideoProviderAdapter, req: { aspectRatio: string; resolution: string; durationS: number; audio: boolean }, deps: Deps, opts: { pollMs: number; timeoutMs: number }): Promise<{ file: string; probe: Probe; seconds: number }> {
  const started = Date.now();
  const { providerJobId } = await adapter.createJob({ prompt: PROMPT, ...req });
  deps.log(`  submitted (${adapter.modelId})`);
  for (;;) {
    if (Date.now() - started > opts.timeoutMs) throw new Error(`No result after ${Math.round(opts.timeoutMs / 1000)} s; the job may still finish on the provider's side.`);
    await deps.sleep(opts.pollMs);
    const status = await adapter.getJob!(providerJobId);
    if (status.kind === "pending") continue;
    if (status.kind === "failed") throw new Error(`${status.errorCode ?? "FAILED"}: ${status.detail ?? "no reason given"}`);
    const bytes = await adapter.downloadResult!(status.outputUrl!);
    await mkdir(deps.outDir, { recursive: true });
    const file = join(deps.outDir, `${adapter.modelKey}.mp4`);
    await writeFile(file, bytes);
    return { file, probe: await deps.ffprobe(file), seconds: Math.round((Date.now() - started) / 1000) };
  }
}

export async function freeCheck(check: LiveCheck, deps: Deps): Promise<{ ok: boolean | null; message: string }> {
  const { env } = deps;
  switch (check.id) {
    case "google": {
      const m = veoModel(env);
      return createVeoTextAdapter({ model: { modelKey: m.key, modelId: m.modelId, capabilities: m.capabilities }, http: deps.http, apiKey: environmentKey("google", env)! }).testConnection!();
    }
    case "fal": {
      const m = falModel(env);
      return createFalAdapter({ model: { modelKey: m.key, endpoint: m.modelId, capabilities: m.capabilities, sendsResolution: m.sendsResolution ?? false, promptMaxChars: m.promptMaxChars }, http: deps.http, apiKey: environmentKey("fal", env)! }).testConnection!();
    }
    case "anthropic":
      return testAnthropic({ apiKey: environmentKey("anthropic", env)!, model: env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL, timeoutMs: 15_000, baseURL: env.ANTHROPIC_BASE_URL });
    case "ollama":
      return testOllama({ baseUrl: env.OLLAMA_URL!, model: env.OLLAMA_MODEL?.trim() || "qwen3:4b", timeoutMs: 10_000, fetch: deps.fetch });
    case "comfyui":
      return comfyAdapter(deps).testConnection!();
    case "supabase":
    case "studio":
      return { ok: null, message: "No separate free check: the run below costs nothing." };
  }
}

function comfyAdapter(deps: Deps) {
  const id = deps.env.TROUPE_LIVE_COMFYUI_TEMPLATE?.trim() || "ltxv-2b-distilled";
  const t = findComfyTemplate(id);
  if (!t) throw new Error(`No bundled ComfyUI template "${id}".`);
  return createComfyAdapter({
    model: {
      modelKey: `comfyui-${t.id}`, label: t.label, baseUrl: comfyUrl(deps.env).replace(/\/$/, ""), token: deps.env.TROUPE_LIVE_COMFYUI_TOKEN?.trim() || undefined,
      workflow: t.workflow, bindings: t.bindings, capabilities: t.capabilities, fps: t.fps, frameRule: t.frameRule, sizeTable: t.sizeTable,
      sizeMultiple: t.sizeMultiple, negativePrompt: t.negativePrompt, outputNodeId: t.outputNodeId, requiredFiles: t.requiredFiles, vramGb: t.vramGb,
    },
    fetch: deps.fetch,
  });
}

async function chatOnce(model: ChatModel) {
  const messages = buildChatPrompt({
    project: { title: "Live check", platform: "tiktok", format: "9:16", language: "en" },
    actor: { name: "Maya", gender: "female", ageRange: "25-34", style: "casual", voiceProfile: "warm and upbeat" },
    script: { version: 1, lines: [{ role: "hook", text: "Hi! Try this.", emotion: "happy" }] },
    actors: [{ id: "maya", name: "Maya", gender: "female", ageRange: "25-34" }],
    durationS: 6, wordsPerSecond: 2.5, instructions: "", history: [], message: "Make it a little warmer.",
  });
  const answer = await model.propose(messages, { schema: proposalJsonSchema(["Maya"]) });
  if (!answer.proposal) throw new Error("The model answered without a script proposal.");
  return answer;
}

// The paid (or free) job itself. Returns one line for the report.
export async function runCheck(check: LiveCheck, deps: Deps): Promise<string> {
  const { env } = deps;
  switch (check.id) {
    case "google": {
      const m = veoModel(env);
      const adapter = createVeoTextAdapter({ model: { modelKey: m.key, modelId: m.modelId, capabilities: m.capabilities }, http: deps.http, apiKey: environmentKey("google", env)! });
      const out = await renderOnce(adapter, { aspectRatio: "9:16", ...cheapest(m) }, deps, { pollMs: 10_000, timeoutMs: 15 * 60_000 });
      return report(out);
    }
    case "fal": {
      const m = falModel(env);
      const adapter = createFalAdapter({ model: { modelKey: m.key, endpoint: m.modelId, capabilities: m.capabilities, sendsResolution: m.sendsResolution ?? false, promptMaxChars: m.promptMaxChars }, http: deps.http, apiKey: environmentKey("fal", env)! });
      const out = await renderOnce(adapter, { aspectRatio: "9:16", ...cheapest(m), audio: false }, deps, { pollMs: 10_000, timeoutMs: 15 * 60_000 });
      return report(out);
    }
    case "anthropic": {
      const model = env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;
      const answer = await chatOnce(createAnthropicChat({ apiKey: environmentKey("anthropic", env)!, model, timeoutMs: 180_000, baseURL: env.ANTHROPIC_BASE_URL }));
      const can = claudeCapabilities(model);
      return `${model} proposed a script (${can.structuredOutputs ? "structured outputs" : "schema in the prompt"}): ${JSON.stringify(answer.proposal).slice(0, 120)}…`;
    }
    case "ollama": {
      const model = env.OLLAMA_MODEL?.trim() || "qwen3:4b";
      const answer = await chatOnce(createOllamaChat({ baseUrl: env.OLLAMA_URL!, model, timeoutMs: 300_000, fetch: deps.fetch }));
      return `${model} proposed a script: ${JSON.stringify(answer.proposal).slice(0, 120)}…`;
    }
    case "comfyui": {
      const adapter = comfyAdapter(deps);
      const caps = adapter.capabilities();
      const out = await renderOnce(adapter, { aspectRatio: caps.aspectRatios[0]!, resolution: caps.resolutions[0]!, durationS: Math.min(...caps.durationsS), audio: caps.audio === "always" }, deps, { pollMs: 5_000, timeoutMs: 60 * 60_000 });
      return report(out);
    }
    case "supabase":
      return supabaseRoundTrip(deps);
    case "studio":
      return studioRoundTrip(deps);
  }
}

function report(out: { file: string; probe: Probe; seconds: number }) {
  return `${out.probe.codec} ${out.probe.width}x${out.probe.height}, ${out.probe.durationS.toFixed(2)} s, in ${out.seconds} s: ${out.file}`;
}

async function supabaseRoundTrip(deps: Deps): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const { removeFromSupabase, supabaseDownloadUrl, uploadToSupabase } = await import("~/server/media/supabase");
  const bytes = new Uint8Array(await readFile(join(process.cwd(), "src/test/fixtures/clip.mp4")));
  const path = `live-check/${randomUUID()}.mp4`;
  if (!(await uploadToSupabase(path, bytes))) throw new Error("Supabase storage is not configured.");
  try {
    const signed = await supabaseDownloadUrl(path, null);
    const back = new Uint8Array(await (await deps.fetch(signed, { signal: AbortSignal.timeout(60_000) })).arrayBuffer());
    if (back.length !== bytes.length || back.some((b, i) => b !== bytes[i])) throw new Error("The signed download returned other bytes.");
  } finally {
    await removeFromSupabase([path]);
  }
  const parts = [`Storage: ${bytes.length} bytes up, back through a signed URL, deleted (bucket ${env("SUPABASE_STORAGE_BUCKET", deps) ?? "troupe-media"}, private).`];
  if (deps.env.DATABASE_URL?.trim()) parts.push(await postgresCheck(deps.env.DATABASE_URL));
  return parts.join(" ");
}

const env = (name: string, deps: Deps) => deps.env[name]?.trim() || undefined;

async function postgresCheck(url: string): Promise<string> {
  const [{ default: postgres }, { readFile }, { databaseTls }] = await Promise.all([import("postgres"), import("node:fs/promises"), import("../database-tls.mjs")]);
  const journal = JSON.parse(await readFile(join(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as { entries: unknown[] };
  const sql = postgres(url, { prepare: false, max: 1, ssl: databaseTls(url), onnotice: () => undefined });
  try {
    const [row] = await sql<{ applied: number }[]>`select count(*)::int as applied from drizzle.__drizzle_migrations`;
    const applied = row?.applied ?? 0;
    const open = await sql<{ relname: string }[]>`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'troupe\\_%' and not c.relrowsecurity`;
    if (applied < journal.entries.length) throw new Error(`Postgres has ${applied} of ${journal.entries.length} migrations: run pnpm db:migrate.`);
    if (open.length) throw new Error(`Row level security is off on ${open.map((r) => r.relname).join(", ")}.`);
    return `Postgres: ${applied} migrations applied, row level security on every table.`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function studioRoundTrip(deps: Deps): Promise<string> {
  const base = deps.env.TROUPE_LIVE_STUDIO_URL!.trim().replace(/\/$/, "");
  const health = await deps.fetch(`${base}/api/health`, { signal: AbortSignal.timeout(30_000) });
  if (!health.ok) throw new Error(`${base}/api/health answered HTTP ${health.status}.`);
  const reconcile = await deps.fetch(`${base}/api/jobs/reconcile`, { method: "POST", headers: { "x-reconcile-secret": deps.env.RECONCILE_SECRET!.trim(), "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(120_000) });
  if (!reconcile.ok) throw new Error(`POST /api/jobs/reconcile answered HTTP ${reconcile.status}${reconcile.status === 401 ? ": RECONCILE_SECRET differs from the deployment's" : ""}.`);
  const body = (await reconcile.json()) as { processed?: number };
  return `${base} is up; the job check ran (${body.processed ?? 0} job${body.processed === 1 ? "" : "s"} processed).`;
}
