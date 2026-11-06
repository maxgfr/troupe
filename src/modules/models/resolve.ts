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
  return t && typeof t.ok === "boolean" && typeof t.message === "string" && typeof t.at === "string"
    ? { ok: t.ok, message: t.message, at: t.at }
    : null;
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

// A cloud model added from fal.ai's catalog: as long as the slowest built-in.
export const FAL_CATALOG_TIMEOUT_S = 1800;

const LOCAL_VENDOR: Record<string, string> = { comfyui: "ComfyUI", http: "HTTP endpoint", browser: "This browser" };

export function sanitizeDefaults(
  caps: ModelCapabilities,
  wanted: Partial<ModelDefaults> | null,
  fallback?: ModelDefaults,
): ModelDefaults {
  const pick = <T>(options: T[], ...candidates: (T | undefined)[]) =>
    candidates.find((c) => c !== undefined && options.includes(c)) ?? options[0]!;
  const middle = caps.durationsS.includes(8) ? 8 : caps.durationsS[Math.floor(caps.durationsS.length / 2)];
  return {
    resolution: pick(
      caps.resolutions,
      wanted?.resolution,
      fallback?.resolution,
      caps.resolutions.includes("720p") ? "720p" : undefined,
    ),
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

// The providers whose catalog models render through llm-connect, by the id
// llm-connect calls them with; the key each one renders on.
export const CATALOG_PROVIDERS = ["openrouter", "gateway", "google", "xai", "replicate"] as const;
export type CatalogProviderId = (typeof CATALOG_PROVIDERS)[number];

export const CREDENTIAL_NAME: Record<CredentialId, string> = {
  google: "Google AI",
  fal: "fal.ai",
  openrouter: "OpenRouter",
  gateway: "Vercel AI Gateway",
  xai: "xAI",
  replicate: "Replicate",
  openai: "OpenAI",
  elevenlabs: "ElevenLabs",
};
const CREDENTIAL_ARTICLE: Record<CredentialId, "a" | "an"> = {
  google: "a",
  fal: "a",
  openrouter: "an",
  gateway: "a",
  xai: "an",
  replicate: "a",
  openai: "an",
  elevenlabs: "an",
};

// What a catalog model's row holds besides its settings: which provider
// renders it, and the id that provider's API takes.
export interface CatalogConnection {
  provider: CatalogProviderId;
  model: string;
  // Who makes it ("kwaivgi"), as the catalog names them.
  owner?: string;
}

export function parseCatalogConnection(connection: unknown): CatalogConnection | null {
  const c = connection as Partial<CatalogConnection> | null;
  if (!c || typeof c.model !== "string" || !c.model) return null;
  if (!CATALOG_PROVIDERS.includes(c.provider as CatalogProviderId)) return null;
  return { provider: c.provider as CatalogProviderId, model: c.model, ...(c.owner ? { owner: c.owner } : {}) };
}

// A saved row of a cloud model: which key it renders on, its upstream id and
// who it comes from. null for local models.
function cloudRow(r: ModelConfigRow): { credential: CredentialId; modelId: string; vendor: string } | null {
  if (r.family === "fal") {
    const endpoint = (r.connection as { endpoint?: unknown } | null)?.endpoint;
    return {
      credential: "fal",
      modelId: typeof endpoint === "string" ? endpoint : r.id,
      vendor: `${typeof endpoint === "string" ? endpoint.split("/")[0] : "fal"} via fal.ai`,
    };
  }
  if (r.family === "catalog") {
    const c = parseCatalogConnection(r.connection);
    const provider = c?.provider ?? "openrouter";
    const owner = c?.owner ?? c?.model.split("/")[0];
    const name = CREDENTIAL_NAME[provider];
    return {
      credential: provider,
      modelId: c?.model ?? r.id,
      vendor: owner && owner.toLowerCase() !== provider ? `${owner} via ${name}` : name,
    };
  }
  return null;
}

// Pure merge of the code catalog with saved rows. `checkLocal` lets the
// server veto a local model (bad URL, unreadable token) without this module
// knowing about networks or secrets.
export function resolveCatalog(input: {
  rows: ModelConfigRow[];
  // A provider left out has no key.
  credentials: Partial<Record<CredentialId, CredentialSource>>;
  checkLocal?: (row: ModelConfigRow) => { status: ModelStatus; detail: string } | null;
  // The built-ins with this installation's upstream ids (builtinModels()).
  builtins?: readonly BuiltinModel[];
}): ResolvedModel[] {
  const byId = new Map(input.rows.map((r) => [r.id, r]));
  const builtins = (input.builtins ?? BUILTIN_MODELS).map((b): ResolvedModel => {
    const r = byId.get(b.key);
    const status = credentialStatus(input.credentials[b.credential] ?? "none");
    return {
      key: b.key,
      family: b.family,
      label: b.label,
      vendor: b.vendor,
      kind: "cloud",
      credential: b.credential,
      modelId: b.modelId,
      capabilities: b.capabilities,
      defaults: sanitizeDefaults(b.capabilities, r?.defaults ?? null, b.defaults),
      pricePerSecondUsd: r ? (price(r.pricePerSecondUsd) ?? b.pricePerSecondUsd) : b.pricePerSecondUsd,
      timeoutS: r?.timeoutS ?? b.timeoutS,
      enabled: r?.enabled ?? true,
      archived: false,
      status,
      lastTest: null,
      statusDetail:
        status === "missing-credentials"
          ? `Add a ${b.credential === "google" ? "Google AI" : "fal.ai"} key in Settings.`
          : status === "undecryptable"
            ? "The saved key can no longer be read. Enter it again."
            : null,
    };
  });
  const builtinKeys = new Set(BUILTIN_MODELS.map((b) => b.key));
  const locals = input.rows
    // Photo and voice models are the Shots page's own (media.ts).
    .filter((r) => !builtinKeys.has(r.id) && r.family !== "image" && r.family !== "speech")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((r): ResolvedModel => {
      const caps = r.capabilities;
      const veto = caps
        ? (input.checkLocal?.(r) ?? null)
        : { status: "invalid" as const, detail: "This model has no capabilities. Edit it in Settings." };
      const fallbackCaps: ModelCapabilities = {
        aspectRatios: [],
        resolutions: [],
        durationsS: [],
        audio: "none",
        dialogueLanguages: null,
      };
      // A model added from a provider's catalog (fal.ai's, or one llm-connect
      // renders with): a cloud model on that provider's key.
      const cloud = cloudRow(r);
      if (cloud) {
        const keyStatus = credentialStatus(input.credentials[cloud.credential] ?? "none");
        const status = veto?.status ?? keyStatus;
        return {
          key: r.id,
          family: r.family as ModelFamily,
          label: r.label ?? r.id,
          vendor: cloud.vendor,
          kind: "cloud",
          credential: cloud.credential,
          modelId: cloud.modelId,
          capabilities: caps ?? fallbackCaps,
          defaults: caps ? sanitizeDefaults(caps, r.defaults) : { resolution: "", durationS: 0, audio: false },
          pricePerSecondUsd: price(r.pricePerSecondUsd),
          timeoutS: r.timeoutS ?? FAL_CATALOG_TIMEOUT_S,
          enabled: r.enabled,
          archived: r.archived,
          status,
          statusDetail:
            veto?.detail ??
            (keyStatus === "missing-credentials"
              ? `Add ${CREDENTIAL_ARTICLE[cloud.credential]} ${CREDENTIAL_NAME[cloud.credential]} key in Settings.`
              : keyStatus === "undecryptable"
                ? "The saved key can no longer be read. Enter it again."
                : null),
          lastTest: null,
        };
      }
      return {
        key: r.id,
        family: r.family as ModelFamily,
        label: r.label ?? r.id,
        vendor: LOCAL_VENDOR[r.family] ?? r.family,
        kind: "local",
        credential: null,
        modelId: r.label ?? r.id,
        capabilities: caps ?? fallbackCaps,
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

export function estimateCostUsd(
  model: Pick<ResolvedModel, "kind" | "pricePerSecondUsd">,
  durationS: number,
): number | null {
  if (model.pricePerSecondUsd === null) return model.kind === "local" ? 0 : null;
  return Math.round(model.pricePerSecondUsd * durationS * 100) / 100;
}
