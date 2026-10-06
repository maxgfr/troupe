import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
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
  // Signed in over plain http to another machine with --insecure: later
  // commands on this profile accept it too.
  insecure?: boolean;
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
    return {
      profile: parsed.profile,
      profiles: parsed.profiles && typeof parsed.profiles === "object" ? parsed.profiles : {},
    };
  } catch {
    throw new CliError(`${configPath(env)} is not valid JSON. Fix it or delete it and run troupe login again.`);
  }
}

async function ensureDir(env: Env): Promise<string> {
  const dir = configDir(env);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // mkdir leaves an existing folder as it was.
  await chmod(dir, 0o700);
  return dir;
}

// Written to a new, unpredictably named file then renamed over the old one,
// so a crash never leaves half a file and no one can plant the temp file.
export async function writeConfig(env: Env, config: ConfigFile): Promise<void> {
  const dir = await ensureDir(env);
  const file = configPath(env);
  const temp = join(dir, `.config.json.${randomBytes(8).toString("hex")}.tmp`);
  try {
    await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  await chmod(file, 0o600);
}

// An update holds the lock for milliseconds, so one older than staleMs was
// left by a command that crashed. A command waits longer than that before it
// gives up, so a crash a moment ago never ends the next one with
// CONFIG_LOCKED.
export const LOCK_TIMING = { staleMs: 3_000, waitMs: 8_000 } as const;

const pause = () => new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * 40));
const ageOf = (file: string) =>
  stat(file).then(
    (s) => Date.now() - s.mtimeMs,
    () => null,
  );

// Removes the lock if it is (still) stale. Two commands may both find it
// stale; the second must not then remove the lock the first has just taken,
// so clearing goes through a lock of its own and checks the age again inside.
async function clearStaleLock(lock: string): Promise<void> {
  const breaker = `${lock}.clearing`;
  try {
    await (await open(breaker, "wx", 0o600)).close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // Clearing takes microseconds: an old one was left by a crash too.
    if (((await ageOf(breaker)) ?? 0) > LOCK_TIMING.staleMs) await rm(breaker, { force: true });
    return;
  }
  try {
    if (((await ageOf(lock)) ?? 0) > LOCK_TIMING.staleMs) await rm(lock, { force: true });
  } finally {
    await rm(breaker, { force: true });
  }
}

// Read, change and write under a lock file, so two commands running at once
// (a script, an agent) never drop each other's change.
export async function updateConfig(env: Env, change: (config: ConfigFile) => void): Promise<ConfigFile> {
  const lock = join(await ensureDir(env), "config.json.lock");
  const deadline = Date.now() + LOCK_TIMING.waitMs;
  for (;;) {
    try {
      await (await open(lock, "wx", 0o600)).close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (((await ageOf(lock)) ?? 0) > LOCK_TIMING.staleMs) await clearStaleLock(lock).then(pause);
      else if (Date.now() > deadline)
        throw new CliError(`Another troupe command holds ${lock}. If none is running, delete that file.`, {
          code: "CONFIG_LOCKED",
        });
      else await pause();
    }
  }
  try {
    const config = await readConfig(env);
    change(config);
    await writeConfig(env, config);
    return config;
  } finally {
    await rm(lock, { force: true });
  }
}

// This machine: the access code and cookie never cross a network.
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/i;

export function isLoopback(url: string): boolean {
  return LOOPBACK.test(new URL(url).hostname);
}

// An address as typed, made canonical: https:// unless it says otherwise,
// except on this machine (pnpm dev and Docker listen on plain http there).
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  const schemed = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  let url: URL;
  try {
    url = new URL(schemed ? trimmed : `http://${trimmed}`);
    if (!schemed && !LOOPBACK.test(url.hostname)) url = new URL(`https://${trimmed}`);
  } catch {
    throw usageError(`"${input}" is not a URL. Example: http://127.0.0.1:3000`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw usageError(`Use an http:// or https:// address, not ${url.protocol}`);
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

// The access code, and the cookie that stands for it, only travel in clear
// to this machine, or where the user said the network is trusted.
export function assertSecureTransport(url: string, insecure: boolean): void {
  const parsed = new URL(url);
  if (parsed.protocol === "https:" || insecure || LOOPBACK.test(parsed.hostname)) return;
  throw usageError(
    `${parsed.host} would receive the access code and the studio's cookie unencrypted over http://. Use https://${parsed.host}${parsed.pathname.replace(/\/$/, "")}, or, on a network you trust (your LAN), pass --insecure or set TROUPE_INSECURE=1.`,
  );
}
