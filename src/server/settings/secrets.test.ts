import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SecretUnavailableError, createSecretBox, loadSecretBox, resetSecretBoxCache } from "./secrets";

afterEach(() => {
  vi.unstubAllEnvs();
  resetSecretBoxCache();
});

describe("secret box", () => {
  it("round-trips a value bound to its row identity", () => {
    const box = createSecretBox(Buffer.alloc(32, 7));
    const sealed = box.seal("sk-live-123", "provider:google");
    expect(sealed).not.toContain("sk-live-123");
    expect(box.open(sealed, "provider:google")).toBe("sk-live-123");
  });

  it("refuses a ciphertext moved to another row (AAD mismatch)", () => {
    const box = createSecretBox(Buffer.alloc(32, 7));
    const sealed = box.seal("sk-live-123", "provider:google");
    expect(() => box.open(sealed, "provider:fal")).toThrow(SecretUnavailableError);
  });

  it("refuses a ciphertext sealed with another key and exposes distinct fingerprints", () => {
    const a = createSecretBox(Buffer.alloc(32, 1));
    const b = createSecretBox(Buffer.alloc(32, 2));
    expect(a.fingerprint).not.toBe(b.fingerprint);
    expect(() => b.open(a.seal("x", "row"), "row")).toThrow(SecretUnavailableError);
  });

  it("derives the key from TROUPE_SECRET when set", () => {
    vi.stubEnv("TROUPE_SECRET", "a-long-operator-secret");
    const first = loadSecretBox();
    resetSecretBoxCache();
    const second = loadSecretBox();
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.open(first.seal("v", "r"), "r")).toBe("v");
  });

  it("generates a 0600 key file in the data directory and reuses it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "troupe-secret-"));
    try {
      vi.stubEnv("TROUPE_SECRET", "");
      vi.stubEnv("TROUPE_DATA_DIR", dir);
      const first = loadSecretBox();
      const file = join(dir, "secret.key");
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect((await readFile(file, "utf8")).trim()).toMatch(/^[0-9a-f]{64}$/);
      resetSecretBoxCache();
      expect(loadSecretBox().fingerprint).toBe(first.fingerprint);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses to invent a throwaway key on Vercel", () => {
    vi.stubEnv("TROUPE_SECRET", "");
    vi.stubEnv("VERCEL", "1");
    expect(() => loadSecretBox()).toThrow(/TROUPE_SECRET/);
  });
});
