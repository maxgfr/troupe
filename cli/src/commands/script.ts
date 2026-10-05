import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { type Command, type Context, flag, int, str } from "../command.ts";
import { CliError, usageError } from "../errors.ts";
import { table, truncate } from "../output.ts";
import { formatScript, parseScript, type Script, wordCount } from "../script-format.ts";

export async function scriptVersion(ctx: Context, projectId: string, version?: number): Promise<Script> {
  const history = await ctx.api.script.history.query({ projectId });
  if (history.length === 0) throw new CliError("This project has no script yet. Write one with troupe script set <file>.", { code: "NO_SCRIPT" });
  if (version === undefined) return history.at(-1)!;
  const found = history.find((s) => s.version === version);
  if (!found) throw usageError(`There is no version ${version}; this project has versions 1 to ${history.at(-1)!.version}.`);
  return found;
}

export function scriptText(script: Script): string {
  return table(["#", "ROLE", "EMOTION", "LINE"], script.lines.map((l) => [l.index + 1, l.role, l.emotion, l.text]));
}

const show: Command = {
  path: ["script", "show"],
  project: true,
  summary: "Print the newest script version (or --version N), as a table or, with --text, in the file format troupe script set reads.",
  options: {
    version: { type: "string", value: "<n>", description: "Show this version instead of the newest." },
    text: { type: "boolean", description: "Print the editable file format: one line each, [emotion] in front." },
  },
  async run(ctx, { options }) {
    const project = await ctx.project(str(options, "project"));
    const script = await scriptVersion(ctx, project.id, int(options, "version", { min: 1 }));
    const header = `Version ${script.version} (${script.origin}): ${script.lines.length} lines, ${wordCount(script.lines)} words, about ${script.estimatedDurationS} s to say.`;
    return { data: script, text: flag(options, "text") ? formatScript(script, project.title) : `${header}\n${scriptText(script)}` };
  },
};

const set: Command = {
  path: ["script", "set"],
  args: "<file|->",
  positionals: { min: 1, max: 1 },
  project: true,
  summary: "Save a script file (or stdin with -) as the project's newest version. Lines: [emotion] text; the first is the hook, the last the call to action.",
  examples: ["troupe script set script.txt", "printf '[excited] Stop scrolling.\\nThis is the one.\\n[calm] Follow for more.\\n' | troupe script set -", "troupe script show --json > s.json && troupe script set s.json"],
  async run(ctx, { positionals, options }) {
    const source = positionals[0]!;
    let input: string;
    try {
      input = source === "-" ? await ctx.io.readStdin() : await readFile(resolve(ctx.io.cwd, source), "utf8");
    } catch (error) {
      throw usageError(`Cannot read ${source}: ${(error as Error).message}`);
    }
    const lines = parseScript(input);
    const project = await ctx.project(str(options, "project"));
    // Pasted as the studio's script page does, with the [emotion] tags in
    // the same call: one version, saved whole or not at all.
    const script: Script = await ctx.api.script.paste.mutate({ projectId: project.id, text: lines.map((l) => l.text).join("\n"), emotions: lines.map((l) => l.emotion ?? null) });
    return {
      data: script,
      text: `Saved version ${script.version}: ${script.lines.length} lines, ${wordCount(script.lines)} words, about ${script.estimatedDurationS} s to say.\n${scriptText(script)}`,
    };
  },
};

const versions: Command = {
  path: ["script", "versions"],
  project: true,
  summary: "List the project's script versions, oldest first.",
  async run(ctx, { options }) {
    const project = await ctx.project(str(options, "project"));
    const history = await ctx.api.script.history.query({ projectId: project.id });
    return {
      data: history,
      text: history.length
        ? table(["VERSION", "ORIGIN", "LINES", "SECONDS", "FIRST LINE"], history.map((s) => [s.version, s.origin, s.lines.length, s.estimatedDurationS, truncate(s.lines[0]?.text ?? "", 60)]))
        : "No script yet. Write one with troupe script set <file>.",
    };
  },
};

const restore: Command = {
  path: ["script", "restore"],
  args: "<version>",
  positionals: { min: 1, max: 1 },
  project: true,
  summary: "Bring an older version back as the newest one; history stays intact.",
  async run(ctx, { positionals, options }) {
    const version = Number(positionals[0]);
    if (!Number.isInteger(version) || version < 1) throw usageError(`"${positionals[0]}" is not a version number.`);
    const project = await ctx.project(str(options, "project"));
    const old = await scriptVersion(ctx, project.id, version);
    const script = await ctx.api.script.restore.mutate({ projectId: project.id, scriptId: old.id });
    return { data: script, text: `Version ${version} restored as version ${script.version}.\n${scriptText(script)}` };
  },
};

export const scriptCommands: Command[] = [show, set, versions, restore];
