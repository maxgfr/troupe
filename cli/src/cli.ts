import { type ParseArgsConfig, parseArgs } from "node:util";

import { createApi, exchangeAccessCode, explainError, type Connection } from "./client.ts";
import type { Command, Context, Io, OptionSpec, OptionValues, Project } from "./command.ts";
import { COMMANDS } from "./commands/index.ts";
import { DEFAULT_PROFILE, DEFAULT_URL, normalizeUrl, readConfig, writeConfig, type Profile } from "./config.ts";
import { CliError, EXIT, usageError } from "./errors.ts";
import { json } from "./output.ts";
import { pick } from "./resolve.ts";

export const VERSION = "0.1.0";

const GLOBAL_OPTIONS: Record<string, OptionSpec> = {
  json: { type: "boolean", description: "Print the result as JSON on stdout; errors become JSON on stderr." },
  profile: { type: "string", value: "<name>", description: "The studio profile to use (default: TROUPE_PROFILE, or the last one signed in to)." },
  url: { type: "string", value: "<url>", description: "The studio's address for this command (default: TROUPE_URL, or the profile's)." },
  help: { type: "boolean", short: "h", description: "Show help." },
};

const PROJECT_OPTION: Record<string, OptionSpec> = {
  project: { type: "string", short: "p", value: "<project>", description: "Project id, id prefix or title (default: TROUPE_PROJECT, or the one chosen with troupe projects use)." },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const startsWith = (path: string[], words: string[]) => words.every((word, i) => path[i] === word);

// Command words come first (`troupe render watch`), possibly after global
// options; everything else is left for the command's own parser.
function splitCommand(argv: string[]): { words: string[]; rest: string[] } {
  const rest = [...argv];
  const words: string[] = [];
  let i = 0;
  while (i < rest.length) {
    const token = rest[i]!;
    if (token === "--") break;
    if (token.startsWith("-")) {
      const name = token.replace(/^-+/, "");
      i += GLOBAL_OPTIONS[name]?.type === "string" ? 2 : 1;
      continue;
    }
    const next = [...words, token];
    if (!COMMANDS.some((c) => startsWith(c.path, next))) break;
    words.push(token);
    rest.splice(i, 1);
  }
  return { words, rest };
}

function optionUsage(name: string, spec: OptionSpec): string {
  return `${spec.short ? `-${spec.short}, ` : "    "}--${name}${spec.value ? ` ${spec.value}` : ""}`;
}

function optionLines(options: Record<string, OptionSpec>): string[] {
  const entries = Object.entries(options).map(([name, spec]) => [optionUsage(name, spec), spec.description + (spec.multiple ? " Repeat for more." : "")] as const);
  const width = Math.max(...entries.map(([usage]) => usage.length));
  return entries.map(([usage, description]) => `  ${usage.padEnd(width)}  ${description}`);
}

function commandHelp(command: Command): string {
  const lines = [`Usage: troupe ${command.path.join(" ")}${command.args ? ` ${command.args}` : ""} [options]`, "", command.summary];
  const own = { ...(command.project ? PROJECT_OPTION : {}), ...command.options };
  if (Object.keys(own).length) lines.push("", "Options:", ...optionLines(own));
  lines.push("", "Global options:", ...optionLines(GLOBAL_OPTIONS));
  if (command.examples?.length) lines.push("", "Examples:", ...command.examples.map((e) => `  ${e}`));
  return lines.join("\n");
}

function listHelp(commands: Command[]): string[] {
  const entries = commands.map((c) => [`${c.path.join(" ")}${c.args ? ` ${c.args}` : ""}`, c.summary] as const);
  const width = Math.max(...entries.map(([usage]) => usage.length));
  return entries.map(([usage, summary]) => `  ${usage.padEnd(width)}  ${summary}`);
}

function groupHelp(words: string[]): string {
  const commands = COMMANDS.filter((c) => startsWith(c.path, words));
  return [`Usage: troupe ${words.join(" ")} <command> [options]`, "", "Commands:", ...listHelp(commands), "", `Run troupe ${words.join(" ")} <command> --help for its options.`].join("\n");
}

export function mainHelp(): string {
  return [
    "troupe: drive a self-hosted Troupe studio from the terminal.",
    "",
    "Usage: troupe <command> [options]",
    "",
    "Commands:",
    ...listHelp(COMMANDS),
    "",
    "Global options:",
    ...optionLines({ ...GLOBAL_OPTIONS, version: { type: "boolean", description: "Print the CLI's version." } }),
    "",
    "Environment: TROUPE_URL, TROUPE_ACCESS_CODE, TROUPE_PROFILE, TROUPE_PROJECT, TROUPE_CONFIG_DIR.",
    "Exit status: 0 done, 1 refused or failed, 2 usage, 3 not signed in, 4 studio unreachable, 5 timed out.",
    "Docs: docs/CLI.md",
  ].join("\n");
}

function parseOptions(command: Command, rest: string[]): { positionals: string[]; options: OptionValues } {
  const specs = { ...GLOBAL_OPTIONS, ...(command.project ? PROJECT_OPTION : {}), ...command.options };
  const parserOptions: NonNullable<ParseArgsConfig["options"]> = Object.fromEntries(
    Object.entries(specs).map(([name, spec]) => [name, { type: spec.type, ...(spec.short ? { short: spec.short } : {}), ...(spec.multiple ? { multiple: true } : {}) }]),
  );
  let parsed: { positionals: string[]; values: OptionValues };
  try {
    parsed = parseArgs({ args: rest, options: parserOptions, allowPositionals: true, strict: true }) as { positionals: string[]; values: OptionValues };
  } catch (error) {
    throw usageError(`${(error as Error).message.replace(/\. To specify a positional argument.*$/s, ".")} See troupe ${command.path.join(" ")} --help.`);
  }
  return { positionals: parsed.positionals, options: parsed.values };
}

const sameStudio = (a: string | undefined, b: string) => {
  try {
    return a !== undefined && normalizeUrl(a) === b;
  } catch {
    return false;
  }
};

async function createContext(io: Io, options: OptionValues): Promise<Context> {
  const env = io.env;
  const config = await readConfig(env);
  const profileName = (typeof options.profile === "string" && options.profile) || env.TROUPE_PROFILE || config.profile || DEFAULT_PROFILE;
  const profile: Profile | undefined = config.profiles[profileName];
  const url = normalizeUrl((typeof options.url === "string" && options.url) || env.TROUPE_URL || profile?.url || DEFAULT_URL);
  // The saved cookie goes only to the studio it was issued by.
  const ownProfile = sameStudio(profile?.url, url) ? profile : undefined;

  let cookie: Promise<string | null> | undefined;
  const connection: Connection = {
    url,
    cookie: () => {
      cookie ??= env.TROUPE_ACCESS_CODE ? exchangeAccessCode(url, env.TROUPE_ACCESS_CODE) : Promise.resolve(ownProfile?.cookie ?? null);
      return cookie;
    },
  };
  const api = createApi(connection);

  let workspace: Promise<string> | undefined;
  const workspaceId = () => {
    workspace ??= api.identity.myWorkspaces.query().then((list) => {
      const first = list[0];
      if (!first) throw new CliError("This studio has no workspace yet. Open it once in a browser, then try again.");
      return first.id;
    });
    return workspace;
  };

  const ctx: Context = {
    io,
    json: options.json === true,
    profileName,
    url,
    connection,
    api,
    readConfig: () => readConfig(env),
    async updateProfile(change) {
      const current = await readConfig(env);
      const next = change(current.profiles[profileName]);
      if (next) current.profiles[profileName] = next;
      else delete current.profiles[profileName];
      await writeConfig(env, current);
    },
    async rememberProject(projectId) {
      const current = await readConfig(env);
      const saved = current.profiles[profileName];
      if (saved && !sameStudio(saved.url, url)) return false;
      const { project: _previous, ...rest } = saved ?? { url };
      current.profiles[profileName] = projectId ? { ...rest, project: projectId } : rest;
      current.profile ??= profileName;
      await writeConfig(env, current);
      return true;
    },
    async project(ref) {
      const wanted = ref ?? env.TROUPE_PROJECT ?? ownProfile?.project;
      if (!wanted) throw usageError("No project chosen. Pass --project <id|title>, or choose one with troupe projects use <project>.");
      let projectId = wanted;
      if (!UUID.test(wanted)) {
        const projects = await api.identity.projects.query({ workspaceId: await workspaceId() });
        projectId = pick(projects, wanted, { kind: "project", listCommand: "troupe projects list", id: (p) => p.id, names: (p) => [p.title] }).id;
      }
      try {
        return (await api.studio.getProject.query({ projectId })) as Project;
      } catch (error) {
        const explained = explainError(error, url);
        if (explained.code === "NOT_FOUND") throw new CliError(`Project ${wanted} does not exist in this studio. List them with troupe projects list.`, { code: "NOT_FOUND" });
        throw explained;
      }
    },
    workspaceId,
    note(text) {
      if (!options.json) io.stderr(`${text}\n`);
    },
  };
  return ctx;
}

// Runs one command line; resolves to the exit status.
export async function runCli(argv: string[], io: Io): Promise<number> {
  const wantsJson = argv.includes("--json");
  let url = DEFAULT_URL;
  try {
    if (argv.length === 0 || (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help"))) {
      io.stdout(`${mainHelp()}\n`);
      return EXIT.ok;
    }
    if (argv.length === 1 && argv[0] === "--version") {
      io.stdout(`${VERSION}\n`);
      return EXIT.ok;
    }
    const { words, rest } = splitCommand(argv);
    const command = COMMANDS.find((c) => c.path.length === words.length && startsWith(c.path, words));
    if (!command) {
      if (words.length > 0) {
        const asked = rest.includes("--help") || rest.includes("-h");
        (asked ? io.stdout : io.stderr)(`${groupHelp(words)}\n`);
        return asked ? EXIT.ok : EXIT.usage;
      }
      const unknown = rest.find((token) => !token.startsWith("-"));
      throw usageError(`${unknown ? `Unknown command "${unknown}".` : "Missing command."} Run troupe --help for the list.`);
    }
    const input = parseOptions(command, rest);
    if (input.options.help) {
      io.stdout(`${commandHelp(command)}\n`);
      return EXIT.ok;
    }
    const range = command.positionals ?? { min: 0, max: 0 };
    if (input.positionals.length < range.min || input.positionals.length > range.max) {
      throw usageError(`Usage: troupe ${command.path.join(" ")}${command.args ? ` ${command.args}` : ""}. See --help.`);
    }
    const ctx = await createContext(io, input.options);
    url = ctx.url;
    const result = await command.run(ctx, input);
    if (ctx.json) io.stdout(`${json(result.data)}\n`);
    else if (result.text) io.stdout(`${result.text}\n`);
    return result.exitCode ?? EXIT.ok;
  } catch (error) {
    const failure = explainError(error, url);
    if (wantsJson) io.stderr(`${json({ error: { code: failure.code, message: failure.message, exitCode: failure.exitCode } })}\n`);
    else io.stderr(`troupe: ${failure.message}\n`);
    return failure.exitCode;
  }
}
