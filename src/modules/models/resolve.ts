import type { ModelCapabilities, ModelFamily, VideoProviderAdapter } from "~/modules/generation";
import { BUILTIN_MODELS, type BuiltinModel, type CredentialId } from "./builtins";

export type ModelStatus = "ready" | "missing-credentials" | "undecryptable" | "invalid" | "unsupported-host";
export type CredentialSource = "saved" | "environment" | "disabled" | "none" | "undecryptable";

export interface ModelDefaults {
  resolution: string;
  durationS: number;
  audio: boolean;
}

// A troupe_model_config row: overrides for a built-in, or a whole local model.
export interface ModelConfigRow {
  id: string;
  family: string;
  label: string | null;
  enabled: boolean;
  archived: boolean;
  defaults: ModelDefaults | null;
  pricePerSecondUsd: string | null;
  timeoutS: number | null;
  capabilities: ModelCapabilities | null;
  connection: unknown;
  secretCiphertext: string | null;
  secretFingerprint: string | null;
  createdAt: Date;
}

export interface ResolvedModel {
  key: string;
  family: ModelFamily;
  label: string;
  vendor: string;
  kind: "cloud" | "local";
  credential: CredentialId | null;
  modelId: string;
  capabilities: ModelCapabilities;
  defaults: ModelDefaults;
  pricePerSecondUsd: number | null;
  timeoutS: number;
  enabled: boolean;
  archived: boolean;
  status: ModelStatus;
  statusDetail: string | null;
  // A local model's last connection test (Settings, the CLI, or when it was
  // added); null before any, and for cloud models, whose keys Settings tests.
  lastTest: ModelTestResult | null;
}

export interface ModelTestResult {
  ok: boolean;
  message: string;
  at: string;
}

function lastTestOf(connection: unknown): ModelTestResult | null {
  const t = (connection as { lastTest?: Partial<ModelTestResult> } | null)?.lastTest;
  return t && typeof t.ok === "boolean" && typeof t.message === "string" && typeof t.at === "string" ? { ok: t.ok, message: t.message, at: t.at } : null;
}

// What a request sees: every model with its status, an adapter for each model
// that can still be reached (including disabled and archived ones, so their
// in-flight jobs finish), and the effective default.
export interface ModelCatalog {
  models: ResolvedModel[];
  adapters: ReadonlyMap<string, VideoProviderAdapter>;
  defaultModelKey: string | null;
}

// Local models wait on one GPU queue: hours, not minutes.
export const LOCAL_TIMEOUT_S = 7200;

const LOCAL_VENDOR: Record<string, string> = { comfyui: "ComfyUI", http: "HTTP endpoint", browser: "This browser" };

export function sanitizeDefaults(caps: ModelCapabilities, wanted: Partial<ModelDefaults> | null, fallback?: ModelDefaults): ModelDefaults {
  const pick = <T,>(options: T[], ...candidates: (T | undefined)[]) => candidates.find((c) => c !== undefined && options.includes(c)) ?? options[0]!;
  const middle = caps.durationsS.includes(8) ? 8 : caps.durationsS[Math.floor(caps.durationsS.length / 2)];
  return {
    resolution: pick(caps.resolutions, wanted?.resolution, fallback?.resolution, caps.resolutions.includes("720p") ? "720p" : undefined),
    durationS: pick(caps.durationsS, wanted?.durationS, fallback?.durationS, middle),
    audio: caps.audio === "always" ? true : caps.audio === "none" ? false : (wanted?.audio ?? fallback?.audio ?? true),
  };
}

function credentialStatus(source: CredentialSource): ModelStatus {
  if (source === "saved" || source === "environment") return "ready";
  if (source === "undecryptable") return "undecryptable";
  return "missing-credentials";
}

const price = (value: string | null) => (value === null ? null : Number(value));

// Pure merge of the code catalog with saved rows. `checkLocal` lets the
// server veto a local model (bad URL, unreadable token) without this module
// knowing about networks or secrets.
export function resolveCatalog(input: {
  rows: ModelConfigRow[];
  credentials: Record<CredentialId, CredentialSource>;
  checkLocal?: (row: ModelConfigRow) => { status: ModelStatus; detail: string } | null;
  // The built-ins with this installation's upstream ids (builtinModels()).
  builtins?: readonly BuiltinModel[];
}): ResolvedModel[] {
  const byId = new Map(input.rows.map((r) => [r.id, r]));
  const builtins = (input.builtins ?? BUILTIN_MODELS).map((b): ResolvedModel => {
    const r = byId.get(b.key);
    const status = credentialStatus(input.credentials[b.credential]);
    return {
      key: b.key, family: b.family, label: b.label, vendor: b.vendor, kind: "cloud", credential: b.credential,
      modelId: b.modelId, capabilities: b.capabilities,
      defaults: sanitizeDefaults(b.capabilities, r?.defaults ?? null, b.defaults),
      pricePerSecondUsd: r ? price(r.pricePerSecondUsd) ?? b.pricePerSecondUsd : b.pricePerSecondUsd,
      timeoutS: r?.timeoutS ?? b.timeoutS,
      enabled: r?.enabled ?? true,
      archived: false,
      status,
      lastTest: null,
      statusDetail: status === "missing-credentials" ? `Add a ${b.credential === "google" ? "Google AI" : "fal.ai"} key in Settings.` : status === "undecryptable" ? "The saved key can no longer be read. Enter it again." : null,
    };
  });
  const builtinKeys = new Set(BUILTIN_MODELS.map((b) => b.key));
  const locals = input.rows
    .filter((r) => !builtinKeys.has(r.id))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((r): ResolvedModel => {
      const caps = r.capabilities;
      const veto = caps ? input.checkLocal?.(r) ?? null : { status: "invalid" as const, detail: "This model has no capabilities. Edit it in Settings." };
      const fallbackCaps: ModelCapabilities = { aspectRatios: [], resolutions: [], durationsS: [], audio: "none", dialogueLanguages: null };
      return {
        key: r.id, family: r.family as ModelFamily, label: r.label ?? r.id, vendor: LOCAL_VENDOR[r.family] ?? r.family, kind: "local", credential: null,
        modelId: r.label ?? r.id, capabilities: caps ?? fallbackCaps,
        defaults: caps ? sanitizeDefaults(caps, r.defaults) : { resolution: "", durationS: 0, audio: false },
        pricePerSecondUsd: price(r.pricePerSecondUsd) ?? 0,
        timeoutS: r.timeoutS ?? LOCAL_TIMEOUT_S,
        enabled: r.enabled,
        archived: r.archived,
        status: veto?.status ?? "ready",
        statusDetail: veto?.detail ?? null,
        lastTest: lastTestOf(r.connection),
      };
    });
  return [...builtins, ...locals];
}

export function canLaunch(model: ResolvedModel) {
  return model.status === "ready" && model.enabled && !model.archived;
}

export function effectiveDefaultModel(models: ResolvedModel[], savedKey: string | null): string | null {
  const saved = savedKey ? models.find((m) => m.key === savedKey) : undefined;
  if (saved && canLaunch(saved)) return saved.key;
  return models.find(canLaunch)?.key ?? null;
}

export function estimateCostUsd(model: Pick<ResolvedModel, "kind" | "pricePerSecondUsd">, durationS: number): number | null {
  if (model.pricePerSecondUsd === null) return model.kind === "local" ? 0 : null;
  return Math.round(model.pricePerSecondUsd * durationS * 100) / 100;
}
