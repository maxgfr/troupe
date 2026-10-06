import type { Outputs } from "../client.ts";
import {
  type Command,
  type Context,
  flag,
  int,
  type OptionSpec,
  type OptionValues,
  type Project,
  str,
} from "../command.ts";
import { CliError, EXIT, usageError } from "../errors.ts";
import { fields, numberRanges, sentence, shortId, table, when } from "../output.ts";
import { pick } from "../resolve.ts";
import { modelState } from "./models.ts";
import { scriptVersion } from "./script.ts";

export type Render = Outputs["generation"]["forProject"][number];
type Model = Outputs["settings"]["models"]["list"]["models"][number];

export const LAUNCH_OPTIONS: Record<string, OptionSpec> = {
  model: {
    type: "string",
    value: "<model>",
    description: "Video model (default: the project's, else the studio's default).",
  },
  duration: {
    type: "string",
    value: "<seconds>",
    description: "Clip length (default: the model's, or the shortest it offers that fits the script).",
  },
  resolution: { type: "string", value: "<res>", description: "e.g. 720p (default: the model's)." },
  audio: { type: "boolean", description: "Ask for audio (default: the model's setting)." },
  "no-audio": { type: "boolean", description: "Ask for a silent video." },
};

export const WATCH_OPTIONS: Record<string, OptionSpec> = {
  interval: { type: "string", value: "<seconds>", description: "Seconds between checks (default 2)." },
  timeout: {
    type: "string",
    value: "<seconds>",
    description: "Stop waiting after this long, exit status 5 (default: no limit).",
  },
};

export interface LaunchSettings {
  modelKey: string;
  durationS: number;
  resolution: string;
  audio: boolean;
  language: string;
}

// What the launch panel would preselect, from the model's capabilities and
// defaults; the clip grows to the shortest offered length that fits the
// script when the default is too short for it.
export async function launchSettings(
  ctx: Context,
  project: Project,
  estimatedS: number,
  options: OptionValues,
): Promise<{ settings: LaunchSettings; model: Model }> {
  const { models, defaultModelKey } = await ctx.api.settings.models.list.query();
  const ref = str(options, "model") ?? project.modelKey ?? defaultModelKey;
  if (!ref)
    throw usageError(
      "No video model chosen and the studio has no default. Pass --model <model> (see troupe models list).",
    );
  const model = pick(models, ref, {
    kind: "model",
    listCommand: "troupe models list",
    id: (m) => m.key,
    names: (m) => [m.label],
  });
  if (model.status !== "ready" || !model.enabled || model.archived) {
    throw new CliError(
      `${model.label} cannot launch (${modelState(model)}${model.statusDetail ? `: ${model.statusDetail}` : ""}). Pick another with --model.`,
      { code: "MODEL_UNAVAILABLE" },
    );
  }
  let durationS = int(options, "duration", { min: 1 });
  if (durationS !== undefined && estimatedS > durationS) {
    throw new CliError(
      `The script takes about ${estimatedS} s to say, but the clip is ${durationS} s. Shorten it to ${Math.floor(durationS * 2.5)} words or pass a longer --duration (${model.label} offers ${numberRanges(model.capabilities.durationsS)} s).`,
      { code: "SCRIPT_TOO_LONG" },
    );
  }
  if (durationS === undefined) {
    durationS = model.defaults.durationS;
    if (estimatedS > durationS) {
      const fits = [...model.capabilities.durationsS].sort((a, b) => a - b).find((d) => d >= estimatedS);
      if (fits === undefined) {
        throw new CliError(
          `The script takes about ${estimatedS} s to say, and ${model.label} renders at most ${Math.max(...model.capabilities.durationsS)} s. Shorten it (2.5 words per second).`,
          { code: "SCRIPT_TOO_LONG" },
        );
      }
      ctx.note(
        `The script takes about ${estimatedS} s to say, so the clip is ${fits} s (${model.label}'s default is ${durationS} s).`,
      );
      durationS = fits;
    }
  }
  if (flag(options, "audio") && flag(options, "no-audio")) throw usageError("Pass --audio or --no-audio, not both.");
  const audio = flag(options, "no-audio") ? false : flag(options, "audio") ? true : model.defaults.audio;
  return {
    model,
    settings: {
      modelKey: model.key,
      durationS,
      resolution: str(options, "resolution") ?? model.defaults.resolution,
      audio,
      language: project.language,
    },
  };
}

export async function findRender(ctx: Context, projectId: string, ref?: string): Promise<Render> {
  const renders = await ctx.api.generation.forProject.query({ projectId });
  if (renders.length === 0)
    throw new CliError("This project has no renders yet. Launch one with troupe render launch.", { code: "NO_RENDER" });
  if (!ref || ref === "latest") return renders[0]!;
  return pick(renders, ref, { kind: "render", listCommand: "troupe render list", id: (r) => r.id });
}

function progressLine(render: Render, elapsedS: number): string {
  const share =
    render.progress !== null && render.progress !== undefined ? ` ${Math.round(render.progress * 100)}%` : "";
  return `${shortId(render.id)} ${render.status.replace("_", " ")}${share} (${elapsedS} s)`;
}

export function renderSummary(render: Render): string {
  if (render.status === "completed") {
    const length = render.mediaDurationS ? `${render.mediaDurationS.toFixed(2)} s video` : `${render.durationS} s clip`;
    return `Render ${shortId(render.id)} completed: ${length}, ${render.resolution} ${render.aspectRatio}, ${render.modelLabel}.\nDownload it: troupe download ${shortId(render.id)}`;
  }
  if (render.status === "failed") {
    const next = render.relaunched
      ? "It was relaunched already: troupe render list shows the newer render."
      : `Try it again with troupe render relaunch ${shortId(render.id)}.`;
    return `Render ${shortId(render.id)} failed: ${sentence(render.errorDetail ?? render.errorCode ?? "no reason given")}\n${next}`;
  }
  return `Render ${shortId(render.id)} is ${render.status.replace("_", " ")}. Follow it with troupe render watch ${shortId(render.id)}.`;
}

// Polls the project's timeline (which also moves the job along when no
// background worker runs) until the render completes or fails.
export function watchOptions(options: OptionValues): { intervalS: number; timeoutS?: number } {
  const intervalS = Number(str(options, "interval") ?? 2);
  if (!Number.isFinite(intervalS) || intervalS <= 0) throw usageError("--interval takes a number of seconds above 0.");
  return { intervalS, timeoutS: int(options, "timeout", { min: 1 }) };
}

// For commands that may watch: their options are checked up front.
export const validateWatch: Command["validate"] = ({ options }) => void watchOptions(options);

export async function watchRender(
  ctx: Context,
  projectId: string,
  renderId: string,
  options: OptionValues,
): Promise<{ render: Render; exitCode: (typeof EXIT)[keyof typeof EXIT] }> {
  const { intervalS, timeoutS } = watchOptions(options);
  const started = Date.now();
  const live = ctx.io.stderrIsTTY && !ctx.json;
  let last = "";
  for (;;) {
    const render = (await ctx.api.generation.forProject.query({ projectId })).find((r) => r.id === renderId);
    if (!render) throw new CliError(`Render ${renderId} no longer exists.`, { code: "NOT_FOUND" });
    const elapsedS = Math.round((Date.now() - started) / 1000);
    const line = progressLine(render, elapsedS);
    const changed = line.replace(/ \(\d+ s\)$/, "") !== last.replace(/ \(\d+ s\)$/, "");
    if (live) ctx.io.stderr(`\r\u001b[K${line}`);
    else if (changed && !ctx.json) ctx.io.stderr(`${line}\n`);
    last = line;
    if (render.status === "completed" || render.status === "failed") {
      if (live) ctx.io.stderr("\n");
      return { render, exitCode: render.status === "failed" ? EXIT.failed : EXIT.ok };
    }
    if (timeoutS !== undefined && elapsedS >= timeoutS) {
      if (live) ctx.io.stderr("\n");
      throw new CliError(
        `Render ${shortId(renderId)} is still ${render.status.replace("_", " ")} after ${timeoutS} s; it keeps running in the studio. Do not launch it again: resume with troupe render watch ${shortId(renderId)} --timeout ${Math.max(timeoutS, 500)}.`,
        { exitCode: EXIT.timeout, code: "TIMEOUT" },
      );
    }
    await ctx.io.sleep(intervalS * 1000);
  }
}

const launch: Command = {
  path: ["render", "launch"],
  project: true,
  summary: "Render the newest script version (or --version N) as a draft video.",
  options: {
    version: { type: "string", value: "<n>", description: "Script version to render (default: the newest)." },
    ...LAUNCH_OPTIONS,
    watch: { type: "boolean", description: "Wait for the render to finish, as troupe render watch does." },
    ...WATCH_OPTIONS,
  },
  examples: [
    "troupe render launch",
    "troupe render launch --model local-renderer --duration 10 --watch --timeout 500",
    "troupe render launch --version 2 --no-audio",
  ],
  validate: validateWatch,
  async run(ctx, { options }) {
    const project = await ctx.project(str(options, "project"));
    const script = await scriptVersion(ctx, project.id, int(options, "version", { min: 1 }));
    const { settings, model } = await launchSettings(ctx, project, script.estimatedDurationS, options);
    const launched = await ctx.api.generation.launchText.mutate({
      projectId: project.id,
      scriptId: script.id,
      ...settings,
    });
    const what = `${model.label}: ${settings.durationS} s, ${settings.resolution}, ${settings.audio ? "with audio" : "silent"}, script version ${script.version}`;
    if (!flag(options, "watch")) {
      return {
        data: launched,
        text: `Launched render ${shortId(launched.id)} on ${what}.\nFollow it: troupe render watch ${shortId(launched.id)}`,
      };
    }
    ctx.note(`Launched render ${shortId(launched.id)} on ${what}.`);
    const { render, exitCode } = await watchRender(ctx, project.id, launched.id, options);
    return { data: render, text: renderSummary(render), exitCode };
  },
};

const list: Command = {
  path: ["render", "list"],
  project: true,
  summary: "List the project's renders, newest first.",
  async run(ctx, { options }) {
    const project = await ctx.project(str(options, "project"));
    const renders = await ctx.api.generation.forProject.query({ projectId: project.id });
    return {
      data: renders,
      text: renders.length
        ? table(
            ["ID", "STATUS", "MODEL", "CLIP", "RES", "TIER", "CREATED", "NOTE"],
            renders.map((r) => [
              shortId(r.id),
              r.status,
              r.modelLabel,
              r.mediaDurationS ? `${r.mediaDurationS.toFixed(2)} s` : `${r.durationS} s`,
              r.resolution,
              r.tier,
              when(r.createdAt),
              [
                r.relaunched ? "relaunched" : "",
                r.status === "failed"
                  ? (r.errorDetail ?? r.errorCode)
                  : r.progress !== null && r.status === "in_progress"
                    ? `${Math.round(r.progress * 100)}%`
                    : "",
              ]
                .filter(Boolean)
                .join("; "),
            ]),
          )
        : "No renders yet. Launch one with troupe render launch.",
    };
  },
};

const status: Command = {
  path: ["render", "status"],
  args: "[render]",
  positionals: { min: 0, max: 1 },
  project: true,
  summary: "Show one render (default: the newest) once, without waiting.",
  async run(ctx, { positionals, options }) {
    const project = await ctx.project(str(options, "project"));
    const render = await findRender(ctx, project.id, positionals[0]);
    return {
      data: render,
      text: `${fields([
        ["Render", render.id],
        ["Status", render.status],
        ["Progress", render.progress !== null ? `${Math.round(render.progress * 100)}%` : null],
        ["Model", `${render.modelLabel} (${render.modelKey})`],
        ["Clip", `${render.durationS} s, ${render.resolution}, ${render.aspectRatio}`],
        ["Video length", render.mediaDurationS ? `${render.mediaDurationS.toFixed(2)} s` : null],
        ["Tier", render.tier],
        ["Cost", render.costUsd !== null ? `$${render.costUsd} (${render.costSource})` : null],
        ["Created", when(render.createdAt)],
        ["Finished", when(render.completedAt)],
        ["Error", render.errorDetail ?? render.errorCode],
      ])}\n\n${renderSummary(render)}`,
      exitCode: render.status === "failed" ? EXIT.failed : EXIT.ok,
    };
  },
};

const watch: Command = {
  path: ["render", "watch"],
  args: "[render]",
  positionals: { min: 0, max: 1 },
  project: true,
  summary: "Follow a render (default: the newest) until it completes (exit 0) or fails (exit 1).",
  options: WATCH_OPTIONS,
  validate: validateWatch,
  async run(ctx, { positionals, options }) {
    const project = await ctx.project(str(options, "project"));
    const target = await findRender(ctx, project.id, positionals[0]);
    const { render, exitCode } = await watchRender(ctx, project.id, target.id, options);
    return { data: render, text: renderSummary(render), exitCode };
  },
};

const relaunch: Command = {
  path: ["render", "relaunch"],
  args: "<render>",
  positionals: { min: 1, max: 1 },
  project: true,
  summary: "Try a failed render again with the same script, model and settings.",
  options: { watch: { type: "boolean", description: "Wait for the new render to finish." }, ...WATCH_OPTIONS },
  validate: validateWatch,
  async run(ctx, { positionals, options }) {
    const project = await ctx.project(str(options, "project"));
    const failed = await findRender(ctx, project.id, positionals[0]);
    const launched = await ctx.api.generation.relaunch.mutate({ projectId: project.id, generationId: failed.id });
    if (!flag(options, "watch"))
      return {
        data: launched,
        text: `Relaunched as render ${shortId(launched.id)}. Follow it: troupe render watch ${shortId(launched.id)}`,
      };
    const { render, exitCode } = await watchRender(ctx, project.id, launched.id, options);
    return { data: render, text: renderSummary(render), exitCode };
  },
};

export const renderCommands: Command[] = [launch, list, status, watch, relaunch];
