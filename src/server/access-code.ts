import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// The private studio's access code. A production server never runs open:
// without TROUPE_ACCESS_CODE it generates one on first start, keeps it in the
// data directory and prints it in the logs (like a Jupyter token). Only
// `pnpm dev` and tests run without a code, and only for loopback requests.

export type AccessCodeSource = "environment" | "file" | "generated" | "none";

let cached: { code: string | null; source: AccessCodeSource } | undefined;

export function resetAccessCodeCache() {
  cached = undefined;
}

export function accessCodeFile() {
  return join(resolve(process.env.TROUPE_DATA_DIR ?? "data"), "access-code");
}

function remember(value: { code: string | null; source: AccessCodeSource }) {
  cached = value;
  return value;
}

export function ensureAccessCode(): { code: string | null; source: AccessCodeSource } {
  const configured = process.env.TROUPE_ACCESS_CODE;
  if (configured) return { code: configured, source: "environment" };
  if (cached) return cached;
  // Serverless file systems are ephemeral: a generated code would change on
  // every cold start. Those deployments must set TROUPE_ACCESS_CODE.
  if (process.env.NODE_ENV !== "production" || process.env.VERCEL) return remember({ code: null, source: "none" });
  const file = accessCodeFile();
  if (existsSync(file)) {
    const code = readFileSync(file, "utf8").trim();
    if (code) return remember({ code, source: "file" });
  }
  mkdirSync(resolve(file, ".."), { recursive: true });
  const code = randomBytes(24).toString("base64url");
  try {
    writeFileSync(file, `${code}\n`, { mode: 0o600, flag: "wx" });
  } catch (error) {
    // Another process won the race: use its code.
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return remember({ code: readFileSync(file, "utf8").trim(), source: "file" });
    throw error;
  }
  return remember({ code, source: "generated" });
}

export function currentAccessCode(): string | null {
  return ensureAccessCode().code;
}

// The Docker stack's `cli` container signs in with the code from a volume of
// its own (TROUPE_ACCESS_CODE_SHARE_DIR, docker-compose.yml), so it never sees
// the data folder, which also holds secret.key. A code set in the environment
// reaches the CLI through its environment instead: a copy left from before
// is removed.
export function shareAccessCode(access: { code: string | null; source: AccessCodeSource }, dir = process.env.TROUPE_ACCESS_CODE_SHARE_DIR) {
  if (!dir) return;
  const file = join(resolve(dir), "access-code");
  if (!access.code || (access.source !== "generated" && access.source !== "file")) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(resolve(dir), { recursive: true });
  const temp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(temp, `${access.code}\n`, { mode: 0o600, flag: "wx" });
  renameSync(temp, file);
}
