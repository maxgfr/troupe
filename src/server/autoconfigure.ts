import { BUILTIN_MODELS, createLocalModel, getDefaultModelKey, getModelConfig, listModelConfigs, LOCAL_TIMEOUT_S, setDefaultModelKey } from "~/modules/models";
import type { ModelCapabilities } from "~/modules/generation";
import type { Db } from "~/server/db/types";
import { buildHttpAdapter, HttpConnection, sealModelToken } from "~/server/local-models";
import { checkLocalUrl } from "~/server/settings/urls";

// First-boot wiring for the Docker stack (docker-compose.yml): the stack's own
// renderer becomes a local model, as if added in Settings → Local models with
// Test then Add model. It runs on every start and changes nothing once that
// model exists, so whatever the user does with it afterwards (rename, archive,
// another default) stays. The script chat needs no wiring: Compose points
// OLLAMA_URL at the stack's Ollama, and Settings → Script chat overrides it.

type Env = Record<string, string | undefined>;

// One fixed key: "has the stack's renderer been added?" is "does this row
// exist?", archived or not.
export const STACK_RENDERER_KEY = "local-stack-renderer";

const DEFAULT_LABEL = "Local renderer";
const DEFAULT_DURATIONS_S = [4, 6, 8, 10, 15];

export interface AutoconfigureSettings {
  renderer: { url: string; label: string; token: string | undefined; durationsS: number[] };
}

const on = (value: string | undefined) => value === "1" || value === "true";

function parseDurations(raw: string | undefined): number[] {
  if (!raw?.trim()) return DEFAULT_DURATIONS_S;
  const values = raw.split(",").map((part) => part.trim());
  const numbers = values.map(Number);
  if (values.some((v) => !/^\d+$/.test(v)) || numbers.some((n) => n < 1 || n > 60)) {
    throw new Error(`TROUPE_RENDERER_DURATIONS must be whole seconds from 1 to 60, separated by commas (got "${raw}").`);
  }
  return [...new Set(numbers)].sort((a, b) => a - b);
}

// Null when there is nothing to do (outside the Docker stack, by default).
export function autoconfigureSettings(env: Env = process.env): AutoconfigureSettings | null {
  const url = env.TROUPE_RENDERER_URL?.trim();
  if (!on(env.TROUPE_AUTOCONFIGURE) || !url) return null;
  return {
    renderer: {
      url,
      label: env.TROUPE_RENDERER_LABEL?.trim() || DEFAULT_LABEL,
      token: env.TROUPE_RENDERER_TOKEN?.trim() || undefined,
      durationsS: parseDurations(env.TROUPE_RENDERER_DURATIONS),
    },
  };
}

// What docs/LOCAL-MODELS.md#add-it-to-troupe tells a person to fill in.
function rendererCapabilities(durationsS: number[]): ModelCapabilities {
  return {
    aspectRatios: ["9:16", "16:9", "1:1"],
    resolutions: ["480p", "540p", "576p", "720p", "1080p"],
    durationsS,
    audio: "always",
    dialogueLanguages: null,
  };
}

export type RendererOutcome =
  | "created"
  // The stack's renderer was added before (the user may have changed it since).
  | "exists"
  // The user added a model at that address themselves.
  | "already-added"
  | "name-taken"
  | "unreachable";

const sameAddress = (a: string, b: string) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

export async function registerStackRenderer(db: Db, settings: AutoconfigureSettings): Promise<RendererOutcome> {
  const { renderer } = settings;
  if (await getModelConfig(db, STACK_RENDERER_KEY)) return "exists";

  const url = checkLocalUrl(renderer.url);
  if (!url.ok) throw new Error(`TROUPE_RENDERER_URL: ${url.reason}`);
  const rows = await listModelConfigs(db);
  const theirs = rows.find((row) => {
    const connection = HttpConnection.safeParse(row.connection);
    return row.family === "http" && connection.success && sameAddress(connection.data.baseUrl, url.base);
  });
  if (theirs) return "already-added";
  const wanted = renderer.label.toLocaleLowerCase();
  const labels = [...BUILTIN_MODELS.map((m) => m.label), ...rows.map((r) => r.label ?? "")];
  if (labels.some((label) => label.trim().toLocaleLowerCase() === wanted)) return "name-taken";

  // Test, as the form does: the renderer must answer, and its /health says
  // how often to check on a render (poll_every_s).
  const capabilities = rendererCapabilities(renderer.durationsS);
  const connection = { baseUrl: url.base, fps: 24 };
  const adapter = buildHttpAdapter({ modelKey: STACK_RENDERER_KEY, label: renderer.label, capabilities, connection, token: renderer.token });
  if (!("createJob" in adapter)) throw new Error(`TROUPE_RENDERER_URL: ${adapter.detail}`);
  const report = await adapter.testConnection!().catch(() => ({ ok: false, pollEveryS: undefined }));
  if (report.ok !== true) return "unreachable";

  try {
    await createLocalModel(db, {
      id: STACK_RENDERER_KEY,
      family: "http",
      label: renderer.label,
      capabilities,
      connection: HttpConnection.parse({ ...connection, pollEveryS: report.pollEveryS }),
      timeoutS: LOCAL_TIMEOUT_S,
      secret: renderer.token ? sealModelToken(STACK_RENDERER_KEY, renderer.token) : null,
    });
  } catch (error) {
    // Another app container got there first.
    if (await getModelConfig(db, STACK_RENDERER_KEY)) return "exists";
    throw error;
  }
  // New projects pick it, unless the user already chose a default.
  if (!(await getDefaultModelKey(db))) await setDefaultModelKey(db, STACK_RENDERER_KEY);
  return "created";
}

export interface AutoconfigureEvent {
  event: "autoconfigure.renderer";
  outcome: RendererOutcome | "gave-up" | "failed";
  [key: string]: unknown;
}

export interface AutoconfigureOptions {
  retryEveryMs?: number;
  // The renderer loads in seconds; past this it is not coming.
  giveUpAfterMs?: number;
  log?: (event: AutoconfigureEvent) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Called at boot without awaiting: retries while the renderer is starting.
export async function startAutoconfigure(db: Db, env: Env = process.env, options: AutoconfigureOptions = {}): Promise<RendererOutcome | "off" | "failed"> {
  const { retryEveryMs = 5_000, giveUpAfterMs = 10 * 60_000, log = (event) => console.info(JSON.stringify(event)) } = options;
  let settings: AutoconfigureSettings | null;
  try {
    settings = autoconfigureSettings(env);
  } catch (error) {
    log({ event: "autoconfigure.renderer", outcome: "failed", error: (error as Error).message });
    return "failed";
  }
  if (!settings) return "off";
  const deadline = Date.now() + giveUpAfterMs;
  let lastError: string | undefined;
  let waiting = false;
  for (;;) {
    let outcome: RendererOutcome | undefined;
    try {
      outcome = await registerStackRenderer(db, settings);
    } catch (error) {
      // The database may still be starting; a bad setting will not get better.
      lastError = (error as Error).message;
      if (lastError.startsWith("TROUPE_RENDERER_URL")) {
        log({ event: "autoconfigure.renderer", outcome: "failed", error: lastError });
        return "failed";
      }
    }
    if (outcome && outcome !== "unreachable") {
      log({ event: "autoconfigure.renderer", outcome, url: settings.renderer.url, ...(outcome === "created" ? { modelKey: STACK_RENDERER_KEY } : {}) });
      return outcome;
    }
    if (Date.now() + retryEveryMs > deadline) {
      log({ event: "autoconfigure.renderer", outcome: "gave-up", url: settings.renderer.url, ...(lastError ? { error: lastError } : {}), hint: "Add it in Settings → Local models once it runs." });
      return outcome ?? "failed";
    }
    // Said once, not every few seconds while the renderer starts.
    if (outcome && !waiting) log({ event: "autoconfigure.renderer", outcome, url: settings.renderer.url, retryEveryS: retryEveryMs / 1000 });
    waiting ||= Boolean(outcome);
    await sleep(retryEveryMs);
  }
}
