import type { Api, Connection, Outputs } from "./client.ts";
import type { ConfigFile, Profile } from "./config.ts";
import { type ExitCode, usageError } from "./errors.ts";

// Everything a command touches outside itself, so tests can run the CLI in
// process with their own streams, environment and clock.
export interface Io {
  env: Record<string, string | undefined>;
  cwd: string;
  stdout(text: string): void;
  stderr(text: string): void;
  readStdin(): Promise<string>;
  stdinIsTTY: boolean;
  stderrIsTTY: boolean;
  // Asks on the terminal without echoing (the access code, API keys).
  promptSecret(question: string): Promise<string>;
  sleep(ms: number): Promise<void>;
}

export interface OptionSpec {
  type: "string" | "boolean";
  short?: string;
  multiple?: boolean;
  // Placeholder shown in help, e.g. "<seconds>".
  value?: string;
  description: string;
}

export type OptionValues = Record<string, string | boolean | string[] | undefined>;

export interface CommandInput {
  positionals: string[];
  options: OptionValues;
}

// What a command hands back: the data --json prints, the text people read,
// and an exit status when it is not success.
export interface Result {
  data: unknown;
  text?: string;
  exitCode?: ExitCode;
}

export type Project = Outputs["studio"]["getProject"];

export interface Context {
  io: Io;
  json: boolean;
  profileName: string;
  url: string;
  connection: Connection;
  api: Api;
  readConfig(): Promise<ConfigFile>;
  // Changes this profile in the config file; returning undefined removes it.
  updateProfile(change: (profile: Profile | undefined) => Profile | undefined): Promise<void>;
  // Saves (or with null forgets) the current project of this profile; false
  // when --url points at another studio than the profile's.
  rememberProject(projectId: string | null): Promise<boolean>;
  // The project --project, TROUPE_PROJECT or `troupe projects use` points at.
  project(ref?: string): Promise<Project>;
  workspaceId(): Promise<string>;
  // Progress for people, on stderr; silent with --json.
  note(text: string): void;
}

export interface Command {
  path: string[];
  summary: string;
  // Positional syntax for the usage line, e.g. "<file|->".
  args?: string;
  positionals?: { min: number; max: number };
  options?: Record<string, OptionSpec>;
  // Takes -p/--project.
  project?: boolean;
  examples?: string[];
  // Checks option values before anything reaches the studio.
  validate?(input: CommandInput): void;
  run(ctx: Context, input: CommandInput): Promise<Result>;
}

export function str(options: OptionValues, name: string): string | undefined {
  const value = options[name];
  return typeof value === "string" ? value : undefined;
}

export function flag(options: OptionValues, name: string): boolean {
  return options[name] === true;
}

export function strings(options: OptionValues, name: string): string[] {
  const value = options[name];
  return Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
}

export function int(options: OptionValues, name: string, opts: { min?: number; max?: number } = {}): number | undefined {
  const raw = str(options, name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || (opts.min !== undefined && n < opts.min) || (opts.max !== undefined && n > opts.max)) {
    const range = opts.min !== undefined && opts.max !== undefined ? ` between ${opts.min} and ${opts.max}` : opts.min !== undefined ? ` of at least ${opts.min}` : "";
    throw usageError(`--${name} takes a whole number${range}, not "${raw}".`);
  }
  return n;
}

// "4,6,8" → [4, 6, 8]; "9:16, 1:1" → ["9:16", "1:1"].
export function list(value: string): string[] {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

export function oneOf<T extends string>(value: string, allowed: readonly T[], name: string): T {
  if (!(allowed as readonly string[]).includes(value)) throw usageError(`--${name} takes one of ${allowed.join(", ")}, not "${value}".`);
  return value as T;
}
