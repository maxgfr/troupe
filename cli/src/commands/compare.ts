import type { Outputs } from "../client.ts";
import { type Command, type Context, flag, int, type OptionValues, type Project, str, strings } from "../command.ts";
import { CliError, EXIT, usageError } from "../errors.ts";
import { fields, numberRanges, shortId, table, truncate, when } from "../output.ts";
import { pick } from "../resolve.ts";
import { absolute } from "./projects.ts";
import { validateWatch, WATCH_OPTIONS, watchOptions } from "./render.ts";
import { scriptVersion } from "./script.ts";
import { comparisonPlan, formatCost } from "../../../src/app/(app)/projects/model-choice.ts";
import { tallyWinner } from "../../../src/modules/benchmark/winner.ts";

// The studio's Compare page (its API is `benchmark`): the same script
// version rendered by two or three models side by side, each render rated
// from 1 to 5; the highest total wins, and a shared top score is a tie.

type Run = Outputs["benchmark"]["get"];
type ModelOption = Outputs["studio"]["modelOptions"]["models"][number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const finished = (status: string) => status === "completed" || status === "failed";

// The run as the API returns it, with absolute video addresses and the
// winner the page shows (null while nobody voted or on a tie).
function runView(ctx: Context, run: Run) {
  const { winnerId, tie } = tallyWinner(run.entries.filter((e) => e.status === "completed"));
  const winner = run.entries.find((e) => e.id === winnerId) ?? null;
  return {
    ...run,
    entries: run.entries.map((e) => ({ ...e, outputAssetUrl: absolute(ctx, e.outputAssetUrl) })),
    winnerModelKey: winner?.modelKey ?? null,
    tie,
  };
}

function runText(ctx: Context, run: Run): string {
  const view = runView(ctx, run);
  const winner = view.entries.find((e) => e.modelKey === view.winnerModelKey);
  const points = (votes: Record<string, number>) => Object.values(votes).reduce((a, b) => a + b, 0);
  const next = run.entries.some((e) => !finished(e.status))
    ? `Follow it: troupe compare watch ${shortId(run.id)}`
    : winner && run.projectId
      ? `Adopt the winner: troupe projects edit ${shortId(run.projectId)} --model ${winner.modelKey}`
      : run.entries.some((e) => e.status === "completed")
        ? `Rate them: troupe compare vote ${shortId(run.id)} <model> <1-5>`
        : null;
  return [
    fields([
      ["Comparison", run.id],
      ["Project", run.projectId],
      ["Script", truncate(run.brief, 100)],
      [
        "Winner",
        winner
          ? `${winner.label} (${points(winner.votes)} points)`
          : view.tie
            ? "tie: two renders share the top score, add a deciding vote"
            : "no votes yet",
      ],
    ]),
    "",
    table(
      ["MODEL", "NAME", "STATUS", "CLIP", "COST", "LATENCY", "SCORE", "VIDEO"],
      view.entries.map((e) => [
        e.modelKey,
        e.label,
        e.status,
        e.mediaDurationS ? `${e.mediaDurationS.toFixed(2)} s` : `${e.durationS} s`,
        e.costUsd === null ? null : formatCost(e.costUsd, e.costSource),
        e.latencyMs === null ? null : `${Math.round(e.latencyMs / 1000)} s`,
        e.meanScore === null ? null : `${Number(e.meanScore.toFixed(1))}/5`,
        e.outputAssetUrl,
      ]),
    ),
    ...(next ? ["", next] : []),
  ].join("\n");
}

// A comparison by id, id prefix or "latest" (default: the newest).
async function findComparison(ctx: Context, ref?: string): Promise<Run> {
  const workspaceId = await ctx.workspaceId();
  let runId = ref && UUID.test(ref) ? ref : undefined;
  if (!runId) {
    const runs = await ctx.api.benchmark.list.query({ workspaceId });
    if (runs.length === 0)
      throw new CliError("No comparison yet. Launch one with troupe compare launch.", { code: "NO_COMPARISON" });
    runId =
      !ref || ref === "latest"
        ? runs[0]!.id
        : pick(runs, ref, { kind: "comparison", listCommand: "troupe compare list", id: (r) => r.id }).id;
  }
  return ctx.api.benchmark.get.query({ workspaceId, runId });
}

// The models, clip length and resolution: from --model, --duration and
// --resolution, or as the project's Compare button picks them (the first two
// or three models that can render the project and share a length fitting the
// script and a resolution; that length is the first model's default when
// they all offer it, the resolution 720p when they all do).
async function comparePlan(ctx: Context, project: Project, estimatedS: number, options: OptionValues) {
  const { models: offered } = await ctx.api.studio.modelOptions.query({
    format: project.format,
    language: project.language,
  });
  const refs = strings(options, "model");
  const chosen = refs.map((ref) =>
    pick(offered, ref, { kind: "model", listCommand: "troupe models list", id: (m) => m.key, names: (m) => [m.label] }),
  );
  if (new Set(chosen.map((m) => m.key)).size !== chosen.length) throw usageError("Pass different models to compare.");
  for (const m of chosen) {
    if (!m.available)
      throw new CliError(`${m.label} cannot launch (${m.unavailableReason}). Pick another with --model.`, {
        code: "MODEL_UNAVAILABLE",
      });
    if (!m.compatible)
      throw new CliError(
        `${m.label} renders ${m.capabilities.aspectRatios.join(" and ")} only, and this project is ${project.format}. Pick another with --model.`,
        { code: "MODEL_UNAVAILABLE" },
      );
    const longest = Math.max(...m.capabilities.durationsS);
    if (longest < estimatedS)
      throw new CliError(
        `The script takes about ${estimatedS} s to say, and ${m.label} renders at most ${longest} s. Shorten it (2.5 words per second) or pick another model.`,
        { code: "SCRIPT_TOO_LONG" },
      );
  }
  const plan = comparisonPlan(chosen.length ? chosen : offered, estimatedS);
  if (!plan.ok || plan.modelKeys.length < chosen.length)
    throw new CliError(
      chosen.length
        ? "These models share no clip length that fits the script and no resolution. Pick others with --model."
        : `${plan.ok ? "" : plan.reason} See troupe models list, or add one with troupe models add.`,
      { code: "CANNOT_COMPARE" },
    );
  const models = plan.modelKeys.map((key) => offered.find((m) => m.key === key)!) as ModelOption[];

  const durationS = int(options, "duration", { min: 1 });
  if (durationS !== undefined && durationS < estimatedS)
    throw new CliError(
      `The script takes about ${estimatedS} s to say, but the clip is ${durationS} s. Shorten it to ${Math.floor(durationS * 2.5)} words or pass a longer --duration.`,
      { code: "SCRIPT_TOO_LONG" },
    );
  const noDuration =
    durationS === undefined ? undefined : models.find((m) => !m.capabilities.durationsS.includes(durationS));
  if (noDuration)
    throw usageError(
      `${noDuration.label} does not render ${durationS} s clips (it offers ${numberRanges(noDuration.capabilities.durationsS)} s).`,
    );
  const resolution = str(options, "resolution");
  const noResolution = resolution ? models.find((m) => !m.capabilities.resolutions.includes(resolution)) : undefined;
  if (noResolution)
    throw usageError(
      `${noResolution.label} does not render ${resolution} (it offers ${noResolution.capabilities.resolutions.join(", ")}).`,
    );
  return { models, durationS: durationS ?? plan.durationS, resolution: resolution ?? plan.resolution };
}

// Polls the run (which also moves its renders along when no background
// worker runs) until every render completes or fails.
async function watchRun(ctx: Context, runId: string, options: OptionValues) {
  const { intervalS, timeoutS } = watchOptions(options);
  const workspaceId = await ctx.workspaceId();
  const started = Date.now();
  let last = "";
  for (;;) {
    const run = await ctx.api.benchmark.get.query({ workspaceId, runId });
    const elapsedS = Math.round((Date.now() - started) / 1000);
    const line = run.entries.map((e) => `${e.label} ${e.status.replace("_", " ")}`).join(", ");
    if (line !== last) ctx.note(`${shortId(runId)}: ${line} (${elapsedS} s)`);
    last = line;
    if (run.entries.every((e) => finished(e.status)))
      return { run, exitCode: run.entries.some((e) => e.status === "failed") ? EXIT.failed : EXIT.ok };
    if (timeoutS !== undefined && elapsedS >= timeoutS)
      throw new CliError(
        `Comparison ${shortId(runId)} is still rendering after ${timeoutS} s; it keeps running in the studio. Do not launch it again: resume with troupe compare watch ${shortId(runId)} --timeout ${Math.max(timeoutS, 500)}.`,
        { exitCode: EXIT.timeout, code: "TIMEOUT" },
      );
    await ctx.io.sleep(intervalS * 1000);
  }
}

const launch: Command = {
  path: ["compare", "launch"],
  project: true,
  summary:
    "Render the newest script version (or --version N) on two or three models side by side, as the Compare models button does; rate them with compare vote.",
  options: {
    model: {
      type: "string",
      multiple: true,
      value: "<model>",
      description:
        "A model to compare, two or three times (default: the first models that can render the project and share a clip length and a resolution, as the studio picks them).",
    },
    version: { type: "string", value: "<n>", description: "Script version to render (default: the newest)." },
    duration: {
      type: "string",
      value: "<seconds>",
      description:
        "Clip length for every model (default: the first model's when they all offer it, else the shortest shared one that fits the script).",
    },
    resolution: {
      type: "string",
      value: "<res>",
      description: "Resolution for every model (default: 720p when they all offer it, else the first they share).",
    },
    watch: { type: "boolean", description: "Wait for every render to finish, as troupe compare watch does." },
    ...WATCH_OPTIONS,
  },
  examples: [
    "troupe compare launch --watch --timeout 500",
    'troupe compare launch --model local-renderer --model "GPU box" --duration 8',
  ],
  validate(input) {
    const models = strings(input.options, "model").length;
    if (models === 1 || models > 3)
      throw usageError("Compare two or three models: pass --model two or three times, or none to let the studio pick.");
    validateWatch?.(input);
  },
  async run(ctx, { options }) {
    const project = await ctx.project(str(options, "project"));
    const script = await scriptVersion(ctx, project.id, int(options, "version", { min: 1 }));
    const plan = await comparePlan(ctx, project, script.estimatedDurationS, options);
    const started = await ctx.api.benchmark.start.mutate({
      projectId: project.id,
      scriptId: script.id,
      modelKeys: plan.models.map((m) => m.key),
      durationS: plan.durationS,
      resolution: plan.resolution,
    });
    const what = `${plan.models.map((m) => m.label).join(", ")}: ${plan.durationS} s, ${plan.resolution}, script version ${script.version}`;
    if (!flag(options, "watch"))
      return {
        data: started,
        text: `Launched comparison ${shortId(started.id)} on ${what}.\nFollow it: troupe compare watch ${shortId(started.id)}`,
      };
    ctx.note(`Launched comparison ${shortId(started.id)} on ${what}.`);
    const { run, exitCode } = await watchRun(ctx, started.id, options);
    return { data: runView(ctx, run), text: runText(ctx, run), exitCode };
  },
};

const list: Command = {
  path: ["compare", "list"],
  summary: "List the comparisons, newest first, with how many models each has and the winner so far.",
  options: {
    before: {
      type: "string",
      value: "<date>",
      description: "Only comparisons started before this date (ISO 8601): the next page after the 50 shown.",
    },
  },
  validate({ options }) {
    const before = str(options, "before");
    if (before !== undefined && Number.isNaN(Date.parse(before)))
      throw usageError(`--before takes a date such as 2026-10-01 or 2026-10-01T18:00:00Z, not "${before}".`);
  },
  async run(ctx, { options }) {
    const before = str(options, "before");
    const runs = await ctx.api.benchmark.list.query({
      workspaceId: await ctx.workspaceId(),
      ...(before ? { before: new Date(before) } : {}),
    });
    return {
      data: runs,
      text: runs.length
        ? table(
            ["ID", "STARTED", "MODELS", "WINNER", "SCRIPT"],
            runs.map((r) => [shortId(r.id), when(r.createdAt), r.entryCount, r.winnerLabel, truncate(r.brief, 60)]),
          )
        : "No comparison yet. Launch one with troupe compare launch.",
    };
  },
};

const show: Command = {
  path: ["compare", "show"],
  args: "[comparison]",
  positionals: { min: 0, max: 1 },
  summary: "Show a comparison (default: the newest) once: each model's render, its status, cost, score and video.",
  async run(ctx, { positionals }) {
    const run = await findComparison(ctx, positionals[0]);
    return { data: runView(ctx, run), text: runText(ctx, run) };
  },
};

const watch: Command = {
  path: ["compare", "watch"],
  args: "[comparison]",
  positionals: { min: 0, max: 1 },
  summary: "Follow a comparison (default: the newest) until every render finishes: exit 0, or 1 when one failed.",
  options: WATCH_OPTIONS,
  validate: validateWatch,
  async run(ctx, { positionals, options }) {
    const target = await findComparison(ctx, positionals[0]);
    const { run, exitCode } = await watchRun(ctx, target.id, options);
    return { data: runView(ctx, run), text: runText(ctx, run), exitCode };
  },
};

const vote: Command = {
  path: ["compare", "vote"],
  args: "<comparison> <model> <score>",
  positionals: { min: 3, max: 3 },
  summary:
    "Rate one model's render from 1 to 5, as the Compare page's quality score does (voting again replaces your score); the highest total wins.",
  examples: ["troupe compare vote latest local-renderer 4", 'troupe compare vote 3f2a "GPU box" 2'],
  validate({ positionals }) {
    const score = Number(positionals[2]);
    if (!Number.isInteger(score) || score < 1 || score > 5)
      throw usageError(`The score is a whole number from 1 to 5, not "${positionals[2]}".`);
  },
  async run(ctx, { positionals }) {
    const run = await findComparison(ctx, positionals[0]);
    const entry = pick(run.entries, positionals[1]!, {
      kind: "model",
      listCommand: `troupe compare show ${shortId(run.id)}`,
      id: (e) => e.modelKey,
      names: (e) => [e.label],
    });
    if (entry.status !== "completed")
      throw new CliError(
        `${entry.label}'s render is ${entry.status.replace("_", " ")}: rate it once it has completed.`,
        {
          code: "NOT_COMPLETED",
        },
      );
    const score = Number(positionals[2]);
    await ctx.api.benchmark.vote.mutate({
      workspaceId: await ctx.workspaceId(),
      runId: run.id,
      entryId: entry.id,
      score,
    });
    const voted = await ctx.api.benchmark.get.query({ workspaceId: await ctx.workspaceId(), runId: run.id });
    return { data: runView(ctx, voted), text: `Rated ${entry.label} ${score}/5.\n\n${runText(ctx, voted)}` };
  },
};

export const compareCommands: Command[] = [launch, list, show, watch, vote];
