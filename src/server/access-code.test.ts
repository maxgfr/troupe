import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { currentAccessCode, ensureAccessCode, resetAccessCodeCache, shareAccessCode } from "./access-code";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "troupe-access-"));
  vi.stubEnv("TROUPE_DATA_DIR", dir);
  vi.stubEnv("TROUPE_ACCESS_CODE", "");
  vi.stubEnv("VERCEL", "");
  resetAccessCodeCache();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  resetAccessCodeCache();
  await rm(dir, { recursive: true, force: true });
});

describe("access code", () => {
  it("uses the configured code as is", () => {
    vi.stubEnv("TROUPE_ACCESS_CODE", "my-code");
    vi.stubEnv("NODE_ENV", "production");
    expect(ensureAccessCode()).toEqual({ code: "my-code", source: "environment" });
  });

  it("generates and keeps a private code in production when none is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const first = ensureAccessCode();
    expect(first.source).toBe("generated");
    expect(first.code).toMatch(/^[A-Za-z0-9_-]{24,}$/);
    expect((await stat(join(dir, "access-code"))).mode & 0o777).toBe(0o600);
    expect((await readFile(join(dir, "access-code"), "utf8")).trim()).toBe(first.code);
    resetAccessCodeCache();
    vi.stubEnv("TROUPE_ACCESS_CODE", "");
    expect(ensureAccessCode()).toEqual({ code: first.code, source: "file" });
    expect(currentAccessCode()).toBe(first.code);
  });

  it("needs no code in development and never invents one on Vercel", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(ensureAccessCode()).toEqual({ code: null, source: "none" });
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    resetAccessCodeCache();
    expect(ensureAccessCode()).toEqual({ code: null, source: "none" });
  });
});

// The Docker stack's CLI container reads the code from a volume of its own,
// never the data volume (which also holds secret.key).
describe("sharing the access code with the CLI", () => {
  it("copies a generated or saved code, owner-only, into the shared folder", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const shared = join(dir, "shared");
    const access = ensureAccessCode();
    shareAccessCode(access, shared);
    expect((await readFile(join(shared, "access-code"), "utf8")).trim()).toBe(access.code);
    expect((await stat(join(shared, "access-code"))).mode & 0o777).toBe(0o600);
    // Only the code: nothing else from the data folder.
    expect(await readdir(shared)).toEqual(["access-code"]);
    resetAccessCodeCache();
    shareAccessCode(ensureAccessCode(), shared);
    expect((await readFile(join(shared, "access-code"), "utf8")).trim()).toBe(access.code);
  });

  it("removes a stale copy when the code comes from the environment, and does nothing without a folder", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const shared = join(dir, "shared");
    shareAccessCode(ensureAccessCode(), shared);
    vi.stubEnv("TROUPE_ACCESS_CODE", "set-in-env-123");
    shareAccessCode(ensureAccessCode(), shared);
    expect(await readdir(shared)).toEqual([]);
    expect(() => shareAccessCode(ensureAccessCode(), undefined)).not.toThrow();
  });
});
