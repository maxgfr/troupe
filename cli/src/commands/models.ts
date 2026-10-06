import type { Context } from "../command.ts";
import { type Command, flag, int, list, oneOf, str } from "../command.ts";
import type { Inputs, Outputs } from "../client.ts";
import { CliError, EXIT, usageError } from "../errors.ts";
import { fields, numberRanges, table } from "../output.ts";
import { pick } from "../resolve.ts";

type Model = Outputs["settings"]["models"]["list"]["models"][number];
type HttpDraft = Extract<Inputs["settings"]["models"]["createLocal"], { family: "http" }>;
type Capabilities = HttpDraft["capabilities"];

const FORMATS = ["9:16", "16:9", "1:1"] as const satisfies readonly Capabilities["aspectRatios"][number][];
const RESOLUTIONS = ["480p", "540p", "576p", "720p", "1080p"] as const satisfies readonly Capabilities["resolutions"][number][];
const AUDIO = ["always", "optional", "none"] as const satisfies readonly Capabilities["audio"][];
const PROVIDERS = ["google", "fal", "anthropic"] as const;

export function modelState(m: Model): string {
  if (m.archived) return "archived";
  if (!m.enabled) return "disabled";
  // Kept although its server did not answer its last test, as Settings says:
  // it can still launch (the server may be up by then).
  if (m.status === "ready" && m.lastTest?.ok === false) return "unreachable";
  return m.status;
}

export async function findModel(ctx: Context, ref: string): Promise<Model> {
  const { models } = await ctx.api.settings.models.list.query();
  return pick(models, ref, { kind: "model", listCommand: "troupe models list", id: (m) => m.key, names: (m) => [m.label] });
}

// Secrets never come from the command line, where shell history and ps see them.
async function readSecret(ctx: Context, opts: { fromStdin: boolean; what: string; option: string }): Promise<string> {
  // On a terminal, stdin would echo what is typed: ask without echo instead.
  const value = ctx.io.stdinIsTTY ? (await ctx.io.promptSecret(`${opts.what}: `)).trim() : opts.fromStdin ? (await ctx.io.readStdin()).trim() : "";
  if (!value) throw usageError(`Pass the ${opts.what.toLowerCase()} on stdin with --${opts.option}, or run the command in a terminal to be asked for it.`);
  return value;
}

const modelsList: Command = {
  path: ["models", "list"],
  summary: "List the video models, with what they render and whether they can launch.",
  options: { all: { type: "boolean", description: "Include archived models." } },
  async run(ctx, { options }) {
    const result = await ctx.api.settings.models.list.query();
    const shown = result.models.filter((m) => flag(options, "all") || !m.archived);
    return {
      // `state` and `launchable` spare scripts from combining status, enabled and archived.
      data: { ...result, models: shown.map((m) => ({ ...m, state: modelState(m), launchable: m.status === "ready" && m.enabled && !m.archived })) },
      text: table(
        ["MODEL", "NAME", "WHERE", "STATE", "FORMATS", "LENGTHS (S)", "AUDIO", "DEFAULT"],
        shown.map((m) => [
          m.key, m.label, m.kind === "local" ? m.vendor : `${m.vendor} (cloud)`, modelState(m),
          m.capabilities.aspectRatios.join(" "), numberRanges(m.capabilities.durationsS), m.capabilities.audio,
          m.key === result.defaultModelKey ? "yes" : "",
        ]),
      ),
    };
  },
};

const modelsAdd: Command = {
  path: ["models", "add"],
  args: "<http|comfyui>",
  positionals: { min: 1, max: 1 },
  summary: "Add a local model: an HTTP server (the local renderer, your own) or ComfyUI with a bundled template. It is tested first.",
  options: {
    name: { type: "string", value: "<name>", description: "Name shown in pickers (required, unique)." },
    "base-url": { type: "string", value: "<url>", description: "Where the model server listens, as the studio reaches it (required), e.g. http://127.0.0.1:8078." },
    "token-stdin": { type: "boolean", description: "Read a bearer token for the server from stdin." },
    formats: { type: "string", value: "<list>", description: "http: formats it renders (default 9:16,16:9,1:1)." },
    resolutions: { type: "string", value: "<list>", description: "http: resolutions (default 720p; 480p 540p 576p 720p 1080p)." },
    durations: { type: "string", value: "<list>", description: "http: clip lengths in seconds (default 4,6,8,10,15)." },
    audio: { type: "string", value: "<mode>", description: "http: always, optional or none (default always)." },
    fps: { type: "string", value: "<n>", description: "http: frames per second (default 24)." },
    template: { type: "string", value: "<id>", description: "comfyui: bundled workflow (troupe models templates lists them; required)." },
    "negative-prompt": { type: "string", value: "<text>", description: "comfyui: what the picture should avoid." },
    timeout: { type: "string", value: "<seconds>", description: "Give up on a render after this long (default 7200)." },
    default: { type: "boolean", description: "Make it the studio's default model." },
    "skip-test": { type: "boolean", description: "Add it even if the test cannot reach it." },
  },
  examples: [
    "troupe models add http --name \"Local renderer\" --base-url http://127.0.0.1:8078 --default",
    "troupe models add http --name \"GPU box\" --base-url http://10.0.0.5:8000 --durations 4,8 --audio optional --token-stdin < token.txt",
    "troupe models add comfyui --name \"Wan on my Mac\" --base-url http://127.0.0.1:8000 --template wan22-ti2v-5b",
  ],
  async run(ctx, { positionals, options }) {
    const family = oneOf(positionals[0]!, ["http", "comfyui"] as const, "family");
    const label = str(options, "name");
    const baseUrl = str(options, "base-url");
    if (!label || !baseUrl) throw usageError("--name and --base-url are required. See troupe models add --help.");
    const token = flag(options, "token-stdin") ? await readSecret(ctx, { fromStdin: true, what: "Token", option: "token-stdin" }) : undefined;
    const timeoutS = int(options, "timeout", { min: 60, max: 86_400 });
    const common = { label, baseUrl, ...(token ? { token } : {}), ...(timeoutS ? { timeoutS } : {}) };

    let draft: Inputs["settings"]["models"]["createLocal"];
    if (family === "http") {
      const durations = list(str(options, "durations") ?? "4,6,8,10,15").map((d) => {
        const n = Number(d);
        if (!Number.isInteger(n) || n < 1 || n > 60) throw usageError(`--durations takes whole seconds between 1 and 60, not "${d}".`);
        return n;
      });
      draft = {
        family, ...common,
        capabilities: {
          aspectRatios: list(str(options, "formats") ?? FORMATS.join(",")).map((f) => oneOf(f, FORMATS, "formats")),
          resolutions: list(str(options, "resolutions") ?? "720p").map((r) => oneOf(r, RESOLUTIONS, "resolutions")),
          durationsS: durations,
          audio: oneOf(str(options, "audio") ?? "always", AUDIO, "audio"),
          dialogueLanguages: null,
        },
        fps: int(options, "fps", { min: 1, max: 120 }) ?? 24,
      };
    } else {
      const templateId = str(options, "template");
      if (!templateId) throw usageError("--template is required for ComfyUI. List them with troupe models templates; custom workflows are added in Settings.");
      draft = { family, ...common, templateId, bindings: [], ...(str(options, "negative-prompt") ? { negativePrompt: str(options, "negative-prompt") } : {}) };
    }

    const report = await ctx.api.settings.models.testDraft.mutate(draft);
    if (report.ok === false && !flag(options, "skip-test")) {
      throw new CliError(`${report.message} Nothing was added; fix the address or pass --skip-test.`, { code: "MODEL_UNREACHABLE" });
    }
    const { modelKey } = await ctx.api.settings.models.createLocal.mutate({ ...draft, ...(family === "http" && report.pollEveryS ? { pollEveryS: report.pollEveryS } : {}) });
    if (flag(options, "default")) await ctx.api.settings.models.setDefault.mutate({ modelKey });
    return {
      data: { modelKey, test: report, default: flag(options, "default") },
      text: [`Added ${label} as ${modelKey}${flag(options, "default") ? " (now the default model)" : ""}.`, `Test: ${report.message}`, ...(report.details ?? [])].join("\n"),
    };
  },
};

const modelsTest: Command = {
  path: ["models", "test"],
  args: "<model>",
  positionals: { min: 1, max: 1 },
  summary: "Contact a model (or check its provider key) and report whether it can render.",
  async run(ctx, { positionals }) {
    const model = await findModel(ctx, positionals[0]!);
    const report = await ctx.api.settings.models.test.mutate({ modelKey: model.key });
    return {
      data: { modelKey: model.key, ...report },
      text: [`${model.label}: ${report.message}`, ...(report.details ?? [])].join("\n"),
      exitCode: report.ok === false ? EXIT.failed : EXIT.ok,
    };
  },
};

const modelsRemove: Command = {
  path: ["models", "remove"],
  args: "<model>",
  positionals: { min: 1, max: 1 },
  summary: "Archive a local model: pickers stop offering it, its renders stay. Built-in models are turned off in Settings instead.",
  options: { restore: { type: "boolean", description: "Bring an archived model back." } },
  async run(ctx, { positionals, options }) {
    const model = await findModel(ctx, positionals[0]!);
    const archived = !flag(options, "restore");
    await ctx.api.settings.models.archive.mutate({ modelKey: model.key, archived });
    return { data: { modelKey: model.key, archived }, text: `${model.label} ${archived ? "archived" : "restored"}.` };
  },
};

const modelsDefault: Command = {
  path: ["models", "default"],
  args: "[model]",
  positionals: { min: 0, max: 1 },
  summary: "Set the model new renders use when none is chosen; --clear goes back to the automatic choice.",
  options: { clear: { type: "boolean", description: "Forget the saved default." } },
  async run(ctx, { positionals, options }) {
    if (flag(options, "clear")) {
      await ctx.api.settings.models.setDefault.mutate({ modelKey: null });
      const { defaultModelKey } = await ctx.api.settings.models.list.query();
      return { data: { defaultModelKey }, text: `Saved default cleared; the studio now uses ${defaultModelKey ?? "no model"}.` };
    }
    if (!positionals[0]) {
      const { defaultModelKey, savedDefaultModelKey } = await ctx.api.settings.models.list.query();
      return { data: { defaultModelKey, savedDefaultModelKey }, text: `Default model: ${defaultModelKey ?? "none"}${savedDefaultModelKey ? "" : " (automatic)"}.` };
    }
    const model = await findModel(ctx, positionals[0]);
    await ctx.api.settings.models.setDefault.mutate({ modelKey: model.key });
    return { data: { defaultModelKey: model.key }, text: `${model.label} is now the default model.` };
  },
};

const modelsTemplates: Command = {
  path: ["models", "templates"],
  summary: "List the bundled ComfyUI workflows for troupe models add comfyui.",
  async run(ctx) {
    const templates = await ctx.api.settings.models.templates.query();
    return {
      data: templates,
      text: table(["TEMPLATE", "NAME", "VRAM", "FORMATS", "LENGTHS (S)", "AUDIO"], templates.map((t) => [t.id, t.label, `${t.vramGb} GB`, t.capabilities.aspectRatios.join(" "), numberRanges(t.capabilities.durationsS), t.capabilities.audio])),
    };
  },
};

const keysList: Command = {
  path: ["keys", "list"],
  summary: "Show which provider keys (Google, fal.ai, Anthropic) are configured, never the keys.",
  async run(ctx) {
    const status = await ctx.api.settings.credentials.status.query();
    return { data: status, text: table(["PROVIDER", "CONFIGURED", "SOURCE"], Object.entries(status).map(([id, s]) => [id, s.configured ? "yes" : "no", s.source])) };
  },
};

const keysSet: Command = {
  path: ["keys", "set"],
  args: "<google|fal|anthropic>",
  positionals: { min: 1, max: 1 },
  summary: "Save a provider API key, encrypted on the server. Read from stdin or a hidden prompt, never from the command line.",
  options: { "key-stdin": { type: "boolean", description: "Read the key from stdin." } },
  examples: ["troupe keys set fal --key-stdin < fal.key", "troupe keys set google"],
  async run(ctx, { positionals, options }) {
    const provider = oneOf(positionals[0]!, PROVIDERS, "provider");
    const key = await readSecret(ctx, { fromStdin: flag(options, "key-stdin"), what: "API key", option: "key-stdin" });
    const status = await ctx.api.settings.credentials.save.mutate({ provider, key });
    return { data: status, text: `${provider} key saved. Check it with troupe keys test ${provider}.` };
  },
};

const keysClear: Command = {
  path: ["keys", "clear"],
  args: "<google|fal|anthropic>",
  positionals: { min: 1, max: 1 },
  summary: "Remove a saved key, or with --disable also ignore the one in the server's environment.",
  options: { disable: { type: "boolean", description: "Ignore the environment's key too." } },
  async run(ctx, { positionals, options }) {
    const provider = oneOf(positionals[0]!, PROVIDERS, "provider");
    const status = await ctx.api.settings.credentials.clear.mutate({ provider, mode: flag(options, "disable") ? "disable" : "remove" });
    return { data: status, text: `${provider}: ${flag(options, "disable") ? "disabled" : "saved key removed"}.` };
  },
};

const keysTest: Command = {
  path: ["keys", "test"],
  args: "<google|fal|anthropic>",
  positionals: { min: 1, max: 1 },
  summary: "Check a provider key without rendering anything (fal.ai cannot be checked for free).",
  async run(ctx, { positionals }) {
    const provider = oneOf(positionals[0]!, PROVIDERS, "provider");
    const report = await ctx.api.settings.credentials.test.mutate({ provider });
    return { data: { provider, ...report }, text: fields([[provider, report.message]]), exitCode: report.ok === false ? EXIT.failed : EXIT.ok };
  },
};

export const modelCommands: Command[] = [modelsList, modelsAdd, modelsTest, modelsRemove, modelsDefault, modelsTemplates, keysList, keysSet, keysClear, keysTest];
