import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { CliError, usageError } from "./errors.ts";

// Where the CLI keeps each studio it signed in to. The file holds the access
// cookie, so it is readable by its owner only (0600, in a 0700 folder).
//
//   ~/.config/troupe/config.json
//   { "profile": "default", "profiles": { "default": { "url": "...", "cookie": "...", "project": "..." } } }

export interface Profile {
  url: string;
  // The studio's access cookie (an HMAC of the access code, never the code).
  // Absent for a studio that runs without a code (pnpm dev on loopback).
  cookie?: string;
  // The project commands use when --project is not given.
  project?: string;
}

export interface ConfigFile {
  // The profile used when neither --profile nor TROUPE_PROFILE is set.
  profile?: string;
  profiles: Record<string, Profile>;
}

export const DEFAULT_PROFILE = "default";
// `pnpm dev`; the Docker stack listens on 3100.
export const DEFAULT_URL = "http://127.0.0.1:3000";

type Env = Record<string, string | undefined>;

export function configDir(env: Env): string {
  if (env.TROUPE_CONFIG_DIR) return env.TROUPE_CONFIG_DIR;
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "troupe");
}

export function configPath(env: Env): string {
  return join(configDir(env), "config.json");
}

export async function readConfig(env: Env): Promise<ConfigFile> {
  let text: string;
  try {
    text = await readFile(configPath(env), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { profiles: {} };
    throw error;
  }
  try {
    const parsed = JSON.parse(text) as Partial<ConfigFile>;
    return { profile: parsed.profile, profiles: parsed.profiles && typeof parsed.profiles === "object" ? parsed.profiles : {} };
  } catch {
    throw new CliError(`${configPath(env)} is not valid JSON. Fix it or delete it and run troupe login again.`);
  }
}

// Written to a temporary file then renamed, so a crash never leaves half a
// file, and chmod-ed in case an older copy had looser permissions.
export async function writeConfig(env: Env, config: ConfigFile): Promise<void> {
  const dir = configDir(env);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = configPath(env);
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, file);
  await chmod(file, 0o600);
}

export function normalizeUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.includes("://") ? input : `http://${input}`);
  } catch {
    throw usageError(`"${input}" is not a URL. Example: http://127.0.0.1:3000`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw usageError(`Use an http:// or https:// address, not ${url.protocol}`);
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}
