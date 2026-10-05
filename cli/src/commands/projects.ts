import type { Outputs } from "../client.ts";
import { type Command, type Context, flag, oneOf, str } from "../command.ts";
import { usageError } from "../errors.ts";
import { fields, shortId, table, when } from "../output.ts";
import { pick } from "../resolve.ts";

type Actor = Outputs["actors"]["list"][number];

const PLATFORMS = ["tiktok", "instagram", "youtube", "linkedin"] as const;
const FORMATS = ["9:16", "1:1", "16:9"] as const;

const absolute = (ctx: Context, path: string | null) => (path ? new URL(path, `${ctx.url}/`).href : null);

export async function findActor(ctx: Context, ref: string): Promise<Actor> {
  const actors = await ctx.api.actors.list.query();
  return pick(actors, ref, { kind: "actor", listCommand: "troupe actors list", id: (a) => a.id, names: (a) => [a.name] });
}

const actorsList: Command = {
  path: ["actors", "list"],
  summary: "List the actor presets: who they are and how they sound.",
  options: {
    gender: { type: "string", value: "<gender>", description: "Only this gender (female, male)." },
    age: { type: "string", value: "<range>", description: "Only this age range, e.g. 25-34." },
    style: { type: "string", value: "<style>", description: "Only this style." },
  },
  async run(ctx, { options }) {
    const filter = { gender: str(options, "gender"), ageRange: str(options, "age"), style: str(options, "style") };
    const actors = (await ctx.api.actors.list.query(filter)).map((a) => ({ ...a, portraitUrl: absolute(ctx, a.portraitUrl) }));
    return {
      data: actors,
      text: table(["ID", "NAME", "GENDER", "AGE", "STYLE", "VOICE", "STATUS"], actors.map((a) => [shortId(a.id), a.name, a.gender, a.ageRange, a.style, a.voiceProfile, a.status])),
    };
  },
};

const actorsShow: Command = {
  path: ["actors", "show"],
  args: "<actor>",
  positionals: { min: 1, max: 1 },
  summary: "Show one actor (by name or id) with the address of their front picture.",
  async run(ctx, { positionals }) {
    const actor = await findActor(ctx, positionals[0]!);
    const data = { ...actor, portraitUrl: absolute(ctx, actor.portraitUrl) };
    return {
      data,
      text: fields([
        ["Name", actor.name], ["Id", actor.id], ["Gender", actor.gender], ["Age", actor.ageRange], ["Style", actor.style],
        ["Voice", actor.voiceProfile], ["Status", actor.status], ["Pictures", `${actor.portraitCount} (set v${actor.assetVersion})`], ["Front picture", data.portraitUrl],
      ]),
    };
  },
};

const projectsList: Command = {
  path: ["projects", "list"],
  summary: "List the studio's projects, newest first, with the stage each is at.",
  async run(ctx) {
    const projects = await ctx.api.identity.projects.query({ workspaceId: await ctx.workspaceId() });
    const config = await ctx.readConfig();
    const current = config.profiles[ctx.profileName]?.project;
    return {
      data: projects,
      text: projects.length
        ? table(["", "ID", "TITLE", "STAGE", "PLATFORM", "FORMAT", "LANG", "MODEL", "CREATED"], projects.map((p) => [p.id === current ? "*" : " ", shortId(p.id), p.title, p.status, p.platform, p.format, p.language, p.modelKey ?? "default", when(p.createdAt)]))
        : "No projects yet. Create one with troupe projects create --title <title> --actor <name>.",
    };
  },
};

const projectsCreate: Command = {
  path: ["projects", "create"],
  summary: "Create a project (what the studio's wizard does) and make it the current one.",
  options: {
    title: { type: "string", value: "<title>", description: "Project title (required)." },
    actor: { type: "string", value: "<actor>", description: "Actor name or id (required; see troupe actors list)." },
    platform: { type: "string", value: "<platform>", description: "tiktok, instagram, youtube or linkedin (default tiktok)." },
    format: { type: "string", value: "<ratio>", description: "9:16, 1:1 or 16:9 (default: the platform's preferred one)." },
    language: { type: "string", value: "<code>", description: "Dialogue language code (default en)." },
    model: { type: "string", value: "<model>", description: "Video model for this project (default: the studio's default)." },
    "no-use": { type: "boolean", description: "Do not make it the current project." },
  },
  examples: ["troupe projects create --title \"Spring drop\" --actor Maya --platform instagram", "troupe projects create --title Teaser --actor 3f2a --format 16:9 --model local-renderer-1a2b"],
  async run(ctx, { options }) {
    const title = str(options, "title");
    const actorRef = str(options, "actor");
    if (!title || !actorRef) throw usageError("--title and --actor are required. See troupe projects create --help.");
    const platform = oneOf(str(options, "platform") ?? "tiktok", PLATFORMS, "platform");
    const formats = await ctx.api.studio.formatOptions.query({ platform });
    const format = oneOf(str(options, "format") ?? formats.find((f) => f.preselected)!.format, FORMATS, "format");
    const warning = formats.find((f) => f.format === format)?.warning;
    const actor = await findActor(ctx, actorRef);
    let modelKey: string | undefined;
    if (str(options, "model")) {
      const { models } = await ctx.api.settings.models.list.query();
      modelKey = pick(models, str(options, "model")!, { kind: "model", listCommand: "troupe models list", id: (m) => m.key, names: (m) => [m.label] }).key;
    }
    const project = await ctx.api.studio.createFromWizard.mutate({
      workspaceId: await ctx.workspaceId(), title, platform, format, language: str(options, "language") ?? "en", actorId: actor.id, ...(modelKey ? { modelKey } : {}),
    });
    const current = !flag(options, "no-use") && (await ctx.rememberProject(project.id));
    if (warning) ctx.note(`Note: ${warning}.`);
    return {
      data: project,
      text: `Created "${project.title}" (${project.id}) with ${actor.name}, ${platform} ${format}.${current ? " It is now the current project." : ""}\nNext: troupe script set <file>${current ? "" : ` --project ${shortId(project.id)}`}`,
    };
  },
};

const projectsShow: Command = {
  path: ["projects", "show"],
  args: "[project]",
  positionals: { min: 0, max: 1 },
  summary: "Show a project: actor, model, newest script version and renders.",
  async run(ctx, { positionals }) {
    const project = await ctx.project(positionals[0]);
    const [actors, history, renders, projects] = await Promise.all([
      ctx.api.actors.list.query(),
      ctx.api.script.history.query({ projectId: project.id }),
      ctx.api.generation.forProject.query({ projectId: project.id }),
      ctx.api.identity.projects.query({ workspaceId: project.workspaceId }),
    ]);
    // The stage as the project list works it out from renders and exports.
    const stage = projects.find((p) => p.id === project.id)?.status ?? project.status;
    const actor = actors.find((a) => a.id === project.actorId);
    const script = history.at(-1) ?? null;
    const latest = renders[0] ?? null;
    return {
      data: { project: { ...project, status: stage }, actor: actor ?? null, script, renders: renders.length, latestRender: latest },
      text: fields([
        ["Title", project.title], ["Id", project.id], ["Stage", stage], ["Platform", `${project.platform} ${project.format}, language ${project.language}`],
        ["Actor", actor ? `${actor.name} (${actor.gender}, ${actor.ageRange}, ${actor.voiceProfile})` : "none"],
        ["Model", project.modelKey ?? "studio default"],
        ["Script", script ? `version ${script.version}, ${script.lines.length} lines, about ${script.estimatedDurationS} s` : "none yet"],
        ["Renders", latest ? `${renders.length}; newest ${shortId(latest.id)} ${latest.status}` : "none yet"],
      ]),
    };
  },
};

const projectsUse: Command = {
  path: ["projects", "use"],
  args: "<project>",
  positionals: { min: 1, max: 1 },
  summary: "Make a project the current one for this profile.",
  async run(ctx, { positionals }) {
    const project = await ctx.project(positionals[0]);
    if (!(await ctx.rememberProject(project.id))) throw usageError(`--url points at another studio than profile "${ctx.profileName}"; sign in to it with troupe login --url ${ctx.url} --profile <name> first.`);
    return { data: { project: { id: project.id, title: project.title } }, text: `Current project: ${project.title} (${project.id}).` };
  },
};

const projectsDelete: Command = {
  path: ["projects", "delete"],
  args: "<project>",
  positionals: { min: 1, max: 1 },
  summary: "Delete a project with its scripts, renders, exports and video files. Needs --yes.",
  options: { yes: { type: "boolean", description: "Confirm the deletion; it cannot be undone." } },
  async run(ctx, { positionals, options }) {
    const project = await ctx.project(positionals[0]);
    if (!flag(options, "yes")) throw usageError(`Deleting "${project.title}" removes its scripts, renders and videos for good. Run again with --yes to confirm.`);
    await ctx.api.studio.deleteProject.mutate({ projectId: project.id });
    const config = await ctx.readConfig();
    if (config.profiles[ctx.profileName]?.project === project.id) await ctx.rememberProject(null);
    return { data: { deleted: true, project: { id: project.id, title: project.title } }, text: `Deleted "${project.title}".` };
  },
};

export const projectCommands: Command[] = [actorsList, actorsShow, projectsList, projectsCreate, projectsShow, projectsUse, projectsDelete];
