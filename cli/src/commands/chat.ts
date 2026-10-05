import type { Outputs } from "../client.ts";
import { type Command, type Context, flag, int, type OptionValues, type Project, str } from "../command.ts";
import { CliError } from "../errors.ts";
import { shortId, table, truncate, when } from "../output.ts";
import { pick } from "../resolve.ts";
import { estimateSeconds, wordCount } from "../script-format.ts";
import { LAUNCH_OPTIONS, launchSettings, renderSummary, WATCH_OPTIONS, watchRender } from "./render.ts";
import { scriptText } from "./script.ts";

type Message = Outputs["chat"]["history"]["messages"][number];
type Proposal = NonNullable<Message["proposal"]>;

function proposalText(message: Message & { proposal: Proposal }, clipS: number | null): string {
  const lines = message.proposal.lines;
  const estimate = estimateSeconds(lines);
  const fit = clipS === null ? "" : estimate > clipS ? `, longer than the ${clipS} s clip` : `, fits the ${clipS} s clip`;
  return [
    table(["#", "ROLE", "EMOTION", "LINE"], lines.map((l, i) => [i + 1, l.role, l.emotion, l.text])),
    `${wordCount(lines)} words, about ${estimate} s to say${fit}.${message.proposal.actorId ? " It also recasts the project." : ""}`,
  ].join("\n");
}

// The proposal a bare `chat apply` means: the newest one not applied yet.
async function findProposal(ctx: Context, projectId: string, ref?: string): Promise<Message & { proposal: Proposal }> {
  const { messages } = await ctx.api.chat.history.query({ projectId });
  const proposals = messages.filter((m): m is Message & { proposal: Proposal } => m.role === "assistant" && m.proposal !== null);
  if (ref) return pick(proposals, ref, { kind: "proposal", listCommand: "troupe chat history", id: (m) => m.id });
  const pending = proposals.filter((m) => !m.appliedScriptId).at(-1);
  if (!pending) throw new CliError("No proposal waits to be applied. Ask for one with troupe chat send <message>.", { code: "NOTHING_TO_APPLY" });
  return pending;
}

// The clip the chat writes for when --duration is not given: the one a
// launch of the newest version would use now (the studio's 8 s when no model
// can launch yet).
async function chatClip(ctx: Context, project: Project, options: OptionValues): Promise<number> {
  const explicit = int(options, "duration", { min: 1, max: 600 });
  if (explicit !== undefined) return explicit;
  const newest = (await ctx.api.script.history.query({ projectId: project.id })).at(-1);
  try {
    return (await launchSettings(ctx, project, newest?.estimatedDurationS ?? 0, options)).settings.durationS;
  } catch {
    return 8;
  }
}

const send: Command = {
  path: ["chat", "send"],
  args: "<message...>",
  positionals: { min: 1, max: 200 },
  project: true,
  summary: "Ask the script chat (Ollama or Claude, as set in the studio) for a change; it answers with a whole new script to apply or ignore.",
  options: { duration: { type: "string", value: "<seconds>", description: "Clip length the script must fit (default: the project's model default)." } },
  examples: ["troupe chat send make the hook punchier and end on a question", "troupe chat send --duration 10 \"write a first draft about our spring jacket\""],
  async run(ctx, { positionals, options }) {
    const project = await ctx.project(str(options, "project"));
    const durationS = await chatClip(ctx, project, options);
    ctx.note("Waiting for the chat model…");
    const { assistant } = await ctx.api.chat.send.mutate({ projectId: project.id, message: positionals.join(" "), durationS });
    const who = `${assistant.provider ?? "chat"} (${assistant.model ?? "?"})`;
    if (!assistant.proposal) return { data: assistant, text: `${who} answered without a script:\n${assistant.content}` };
    return {
      data: assistant,
      text: `${who} proposes (message ${shortId(assistant.id)}): ${assistant.content}\n${proposalText({ ...assistant, proposal: assistant.proposal }, durationS)}\nApply it: troupe chat apply ${shortId(assistant.id)}   (or chat apply-and-launch)`,
    };
  },
};

const history: Command = {
  path: ["chat", "history"],
  project: true,
  summary: "List the project's chat, oldest first, with which proposals were applied.",
  async run(ctx, { options }) {
    const project = await ctx.project(str(options, "project"));
    const [chat, scripts] = await Promise.all([ctx.api.chat.history.query({ projectId: project.id }), ctx.api.script.history.query({ projectId: project.id })]);
    const version = new Map(scripts.map((s) => [s.id, s.version]));
    const newest = scripts.at(-1)?.id ?? null;
    const state = (m: Message) => {
      if (m.role === "user" || !m.proposal) return "";
      if (m.appliedScriptId) return `applied as v${version.get(m.appliedScriptId) ?? "?"}`;
      return m.baseScriptId === newest ? "waiting" : "outdated";
    };
    const provider = chat.provider ? `Chat: ${chat.provider.label} (${chat.provider.modelId})${chat.provider.problem ? `, ${chat.provider.problem}` : ""}.` : "This studio has no script chat.";
    return {
      data: chat,
      text: `${provider}\n${chat.messages.length ? table(["ID", "TIME", "WHO", "PROPOSAL", "MESSAGE"], chat.messages.map((m) => [shortId(m.id), when(m.createdAt), m.role === "user" ? "you" : (m.provider ?? "chat"), state(m), truncate(m.content, 90)])) : "No messages yet."}`,
    };
  },
};

const apply: Command = {
  path: ["chat", "apply"],
  args: "[message]",
  positionals: { min: 0, max: 1 },
  project: true,
  summary: "Save a proposal (default: the newest waiting one) as the project's newest script version.",
  async run(ctx, { positionals, options }) {
    const project = await ctx.project(str(options, "project"));
    const message = await findProposal(ctx, project.id, positionals[0]);
    const { script, actorChanged } = await ctx.api.chat.applyProposal.mutate({ projectId: project.id, messageId: message.id });
    return {
      data: { script, actorChanged },
      text: `Applied as version ${script.version}${actorChanged ? "; the project's actor changed too" : ""}.\n${scriptText(script)}`,
    };
  },
};

const applyAndLaunch: Command = {
  path: ["chat", "apply-and-launch"],
  args: "[message]",
  positionals: { min: 0, max: 1 },
  project: true,
  summary: "Apply a proposal and render the new version at once (refused before anything is saved if the script is too long for the clip).",
  options: { ...LAUNCH_OPTIONS, watch: { type: "boolean", description: "Wait for the render to finish." }, ...WATCH_OPTIONS },
  async run(ctx, { positionals, options }) {
    const project = await ctx.project(str(options, "project"));
    const message = await findProposal(ctx, project.id, positionals[0]);
    const { settings, model } = await launchSettings(ctx, project, estimateSeconds(message.proposal.lines), options);
    const result = await ctx.api.chat.applyAndLaunch.mutate({ projectId: project.id, messageId: message.id, launch: settings });
    const what = `version ${result.script.version} on ${model.label} (${settings.durationS} s, ${settings.resolution})`;
    if (!flag(options, "watch")) {
      return { data: result, text: `Applied and launched ${what}: render ${shortId(result.generation.id)}.\nFollow it: troupe render watch ${shortId(result.generation.id)}` };
    }
    ctx.note(`Applied and launched ${what}: render ${shortId(result.generation.id)}.`);
    const { render, exitCode } = await watchRender(ctx, project.id, result.generation.id, options);
    return { data: { ...result, generation: render }, text: renderSummary(render), exitCode };
  },
};

export const chatCommands: Command[] = [send, history, apply, applyAndLaunch];
