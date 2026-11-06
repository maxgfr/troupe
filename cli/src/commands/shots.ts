import type { Outputs } from "../client.ts";
import { type Command, type Context, flag, int, str, strings } from "../command.ts";
import { CliError, usageError } from "../errors.ts";
import { shortId, table, truncate, when } from "../output.ts";
import { pick } from "../resolve.ts";
import { absolute, findActor } from "./projects.ts";

type Shot = Outputs["shots"]["list"][number];
type ShotModel = Outputs["shots"]["models"]["models"][number];
type MediaModel = Outputs["shots"]["mediaModels"][number];

async function pickMediaModels(
  ctx: Context,
  workspaceId: string,
  medium: "image" | "speech",
  refs: string[],
): Promise<MediaModel[]> {
  const all = (await ctx.api.shots.mediaModels.query({ workspaceId })).filter((m) => m.medium === medium);
  const what = medium === "image" ? "photo" : "voice";
  if (all.length === 0)
    throw new CliError(
      `No ${what} model yet. Find one with troupe models catalog --medium ${medium === "image" ? "image" : "speech"}, then add it with troupe models catalog-add.`,
      { code: "NO_MODEL" },
    );
  if (refs.length === 0) return [all.find((m) => m.available) ?? all[0]!];
  return refs.map((ref) =>
    pick(all, ref, {
      kind: `${what} model`,
      listCommand: "troupe models list",
      id: (m) => m.key,
      names: (m) => [m.label],
    }),
  );
}

async function shotModels(ctx: Context, workspaceId: string) {
  return ctx.api.shots.models.query({ workspaceId });
}

async function findShot(ctx: Context, workspaceId: string, ref: string): Promise<Shot> {
  const shots = await ctx.api.shots.list.query({ workspaceId });
  return pick(shots, ref, { kind: "shot", listCommand: "troupe shots list", id: (s) => s.id });
}

function shotRows(shots: Shot[]) {
  return table(
    ["ID", "TIME", "KIND", "MODEL", "FORMAT", "LENGTH", "STATUS", "TEXT"],
    shots.map((s) => [
      shortId(s.id),
      when(s.createdAt),
      s.medium === "image" ? "photo" : s.medium === "speech" ? "voice" : "video",
      s.modelLabel,
      s.medium === "speech" ? ((s.options as { voice?: string } | null)?.voice ?? "-") : s.aspectRatio || "-",
      s.medium === "image" ? "-" : s.videoDurationS ? `${s.videoDurationS.toFixed(1)} s` : `${s.durationS} s`,
      `${s.status === "in_progress" ? "rendering" : s.status}${s.favorite ? " ★" : ""}`,
      truncate(s.prompt, 60),
    ]),
  );
}

const launch: Command = {
  path: ["shots", "launch"],
  args: "<text...>",
  positionals: { min: 1, max: 400 },
  summary: "Render a described shot on one model or several side by side, without a project or a script.",
  options: {
    model: {
      type: "string",
      multiple: true,
      value: "<model>",
      description: "A model; repeat it (up to 4) to render the shot on each (default: the studio default).",
    },
    format: {
      type: "string",
      value: "<ratio>",
      description: "The format, e.g. 9:16 (default: one every model renders).",
    },
    duration: {
      type: "string",
      value: "<seconds>",
      description: "Clip length (default: the first model's, if all offer it).",
    },
    resolution: {
      type: "string",
      value: "<res>",
      description: "Resolution, e.g. 720p (default: the first model's, if shared).",
    },
    silent: { type: "boolean", description: "Render without sound, on the models that can." },
    actor: { type: "string", value: "<actor>", description: "Describe this actor in the shot." },
    count: {
      type: "string",
      value: "<n>",
      description: "Render it 1 to 4 times on each model (default 1; 8 renders at most).",
    },
  },
  examples: [
    'troupe shots launch "A slow dolly toward a cup of coffee at dawn"',
    "troupe shots launch --model kling-3.0 --format 16:9 --duration 5 --count 2 a drone shot over a beach at sunset",
    'troupe shots launch --model kling-3.0 --model veo-3.1-fast "A neon street at night, rain, slow pan"',
  ],
  async run(ctx, { positionals, options }) {
    const workspaceId = await ctx.workspaceId();
    const { models, defaultModelKey } = await shotModels(ctx, workspaceId);
    const offered = models.filter((m) => !m.needsScript);
    const refs = strings(options, "model");
    if (refs.length > 4) throw usageError("--model takes at most 4 models.");
    const fallback = offered.find((m) => m.key === defaultModelKey) ?? offered.find((m) => m.available);
    const chosen: ShotModel[] = refs.length
      ? refs.map((ref) =>
          pick(models, ref, {
            kind: "model",
            listCommand: "troupe models list",
            id: (m) => m.key,
            names: (m) => [m.label],
          }),
        )
      : fallback
        ? [fallback]
        : [];
    if (chosen.length === 0)
      throw new CliError(
        "No model can render a shot yet. Add a key with troupe keys set, or a local model with troupe models add.",
        { code: "NO_MODEL" },
      );
    const first = chosen[0]!;
    const shared = <T>(get: (m: ShotModel) => T[]): T[] =>
      chosen.reduce((all, m) => all.filter((v) => get(m).includes(v)), get(first));
    const formats = shared((m) => m.capabilities.aspectRatios);
    const lengths = shared((m) => m.capabilities.durationsS);
    const resolutions = shared((m) => m.capabilities.resolutions);
    const labels = chosen.map((m) => m.label);
    const names = labels.length < 3 ? labels.join(" and ") : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
    const format = str(options, "format") ?? (formats.includes("9:16") ? "9:16" : formats[0]);
    if (!format || !formats.includes(format))
      throw usageError(
        formats.length ? `${names} render ${formats.join(", ")}, not ${format}.` : `${names} share no format.`,
      );
    const durationS =
      int(options, "duration", { min: 1, max: 600 }) ??
      (lengths.includes(first.defaults.durationS) ? first.defaults.durationS : lengths[0]);
    if (durationS === undefined) throw usageError(`${names} share no clip length.`);
    const resolution =
      str(options, "resolution") ??
      (resolutions.includes(first.defaults.resolution) ? first.defaults.resolution : resolutions[0]);
    if (!resolution) throw usageError(`${names} share no resolution.`);
    const actor = str(options, "actor");
    const launched = await ctx.api.shots.launch.mutate({
      workspaceId,
      text: positionals.join(" "),
      modelKeys: chosen.map((m) => m.key),
      aspectRatio: format,
      durationS,
      resolution,
      audio: flag(options, "silent") ? false : undefined,
      actorId: actor ? (await findActor(ctx, actor)).id : null,
      count: int(options, "count", { min: 1, max: 4 }) ?? 1,
    });
    const refused = launched.filter((l) => l.status === "failed");
    return {
      data: launched,
      text: [
        `Launched ${launched.length} shot${launched.length === 1 ? "" : "s"} on ${names}: ${launched.map((l) => shortId(l.id)).join(", ")}.`,
        ...refused.map((r) => `${shortId(r.id)} was refused: ${r.errorDetail ?? "the model did not accept it."}`),
        "Follow them: troupe shots list",
      ].join("\n"),
    };
  },
};

const photo: Command = {
  path: ["shots", "photo"],
  args: "<text...>",
  positionals: { min: 1, max: 400 },
  summary: "Draw a described photo on one model or several side by side; it is rendered while you wait.",
  options: {
    model: {
      type: "string",
      multiple: true,
      value: "<model>",
      description: "A photo model; repeat it (up to 4) to draw on each (default: the first that can render).",
    },
    format: { type: "string", value: "<ratio>", description: "The format, e.g. 1:1 (default: one every model takes)." },
    actor: { type: "string", value: "<actor>", description: "Describe this actor in the photo." },
    count: { type: "string", value: "<n>", description: "Draw it 1 to 4 times on each model (default 1)." },
  },
  examples: [
    'troupe shots photo "A ceramic mug of coffee on linen, morning window light"',
    "troupe shots photo --model photo-openai-gpt-image-2 --format 16:9 --count 2 a quiet beach at golden hour",
  ],
  async run(ctx, { positionals, options }) {
    const workspaceId = await ctx.workspaceId();
    const chosen = await pickMediaModels(ctx, workspaceId, "image", strings(options, "model"));
    if (chosen.length > 4) throw usageError("--model takes at most 4 models.");
    const formats = chosen.reduce((all, m) => all.filter((r) => m.aspectRatios.includes(r)), chosen[0]!.aspectRatios);
    const format = str(options, "format") ?? (formats.includes("1:1") ? "1:1" : formats[0]);
    if (!format || !formats.includes(format))
      throw usageError(
        formats.length ? `These models take ${formats.join(", ")}, not ${format}.` : "These models share no format.",
      );
    const actor = str(options, "actor");
    const made = await ctx.api.shots.launchPhoto.mutate({
      workspaceId,
      text: positionals.join(" "),
      modelKeys: chosen.map((m) => m.key),
      aspectRatio: format,
      count: int(options, "count", { min: 1, max: 4 }) ?? 1,
      actorId: actor ? (await findActor(ctx, actor)).id : null,
    });
    return { data: made, text: mediaSummary(made, "photo") };
  },
};

const voice: Command = {
  path: ["shots", "voice"],
  args: "<text...>",
  positionals: { min: 1, max: 400 },
  summary: "Say a text with a voice model; the clip is rendered while you wait.",
  options: {
    model: { type: "string", value: "<model>", description: "The voice model (default: the first that can render)." },
    voice: { type: "string", value: "<voice>", description: "One of the model's voices (default: its own)." },
    delivery: {
      type: "string",
      value: "<text>",
      description: 'How to say it, for a model that takes a delivery ("warm and slow").',
    },
    actor: { type: "string", value: "<actor>", description: "Take this actor's delivery." },
  },
  examples: [
    'troupe shots voice "Hi! I tried this for a week, and it changed my mornings."',
    'troupe shots voice --model voice-openai-gpt-4o-mini-tts --voice coral --delivery "cheerful" Link in my bio!',
  ],
  async run(ctx, { positionals, options }) {
    const workspaceId = await ctx.workspaceId();
    const ref = str(options, "model");
    const [model] = await pickMediaModels(ctx, workspaceId, "speech", ref ? [ref] : []);
    const wanted = str(options, "voice");
    const chosenVoice = wanted
      ? model!.voices
        ? pick(model!.voices, wanted, {
            kind: "voice",
            listCommand: "troupe models list",
            id: (v) => v.id,
            names: (v) => [v.name],
          }).id
        : wanted
      : null;
    const actor = str(options, "actor");
    const made = await ctx.api.shots.launchVoice.mutate({
      workspaceId,
      text: positionals.join(" "),
      modelKey: model!.key,
      voice: chosenVoice,
      instructions: str(options, "delivery") ?? null,
      actorId: actor ? (await findActor(ctx, actor)).id : null,
    });
    return { data: made, text: mediaSummary(made, "voice clip") };
  },
};

function mediaSummary(made: { id: string; status: string; errorDetail: string | null }[], what: string) {
  const done = made.filter((m) => m.status === "completed");
  return [
    done.length
      ? `Made ${done.length} ${what}${done.length === 1 ? "" : "s"}: ${done.map((m) => shortId(m.id)).join(", ")}.`
      : `No ${what} was made.`,
    ...made
      .filter((m) => m.status === "failed")
      .map((m) => `${shortId(m.id)} failed: ${m.errorDetail ?? "the model did not render it."}`),
    "Download it: troupe shots list --json (downloadUrl)",
  ].join("\n");
}

const list: Command = {
  path: ["shots", "list"],
  summary: "List the shots, newest first, with their status and video link.",
  options: { favorites: { type: "boolean", description: "Only the favorites." } },
  async run(ctx, { options }) {
    const workspaceId = await ctx.workspaceId();
    const shots = (await ctx.api.shots.list.query({ workspaceId, favorites: flag(options, "favorites") })).map((s) => ({
      ...s,
      videoUrl: absolute(ctx, s.videoUrl),
      downloadUrl: absolute(ctx, s.downloadUrl),
    }));
    return { data: shots, text: shots.length ? shotRows(shots) : "No shots yet. Make one: troupe shots launch <text>" };
  },
};

const favorite: Command = {
  path: ["shots", "favorite"],
  args: "<shot>",
  positionals: { min: 1, max: 1 },
  summary: "Mark a shot as a favorite (or not, with --off).",
  options: { off: { type: "boolean", description: "Remove it from the favorites." } },
  async run(ctx, { positionals, options }) {
    const workspaceId = await ctx.workspaceId();
    const shot = await findShot(ctx, workspaceId, positionals[0]!);
    const result = await ctx.api.shots.favorite.mutate({
      workspaceId,
      generationId: shot.id,
      on: !flag(options, "off"),
    });
    return { data: result, text: `${shortId(shot.id)} is ${result.favorite ? "a favorite" : "no longer a favorite"}.` };
  },
};

const remove: Command = {
  path: ["shots", "delete"],
  args: "<shot...>",
  positionals: { min: 1, max: 200 },
  summary: "Delete shots and their videos. A shot still rendering is kept.",
  async run(ctx, { positionals }) {
    const workspaceId = await ctx.workspaceId();
    const shots = await ctx.api.shots.list.query({ workspaceId });
    const ids = positionals.map(
      (ref) => pick(shots, ref, { kind: "shot", listCommand: "troupe shots list", id: (s) => s.id }).id,
    );
    const result = await ctx.api.shots.delete.mutate({ workspaceId, generationIds: ids });
    return { data: result, text: `Deleted ${result.deleted} shot${result.deleted === 1 ? "" : "s"}.` };
  },
};

export const shotsCommands: Command[] = [launch, photo, voice, list, favorite, remove];
