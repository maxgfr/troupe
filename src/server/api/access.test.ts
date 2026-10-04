import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESS_COOKIE, accessCookieValue, assertStudioRequest } from "./access";
import { POST } from "~/app/api/access/route";
import { currentAccessCode, resetAccessCodeCache } from "~/server/access-code";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "troupe-access-"));
  vi.stubEnv("TROUPE_DATA_DIR", dir);
  vi.stubEnv("VERCEL", "");
  resetAccessCodeCache();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  resetAccessCodeCache();
  await rm(dir, { recursive: true, force: true });
});

const withCookie = (headers: Record<string, string>, code: string) => new Headers({ ...headers, cookie: `${ACCESS_COOKIE}=${accessCookieValue(code)}` });

describe("private studio access", () => {
  it("requires the code-derived cookie and rejects foreign origins even with a cookie", () => {
    vi.stubEnv("TROUPE_ACCESS_CODE", "fixture-access-code");
    const headers = new Headers({ host: "troupe.example", origin: "https://troupe.example" });
    expect(() => assertStudioRequest(headers)).toThrow();
    headers.set("cookie", `${ACCESS_COOKIE}=${accessCookieValue("fixture-access-code")}`);
    expect(() => assertStudioRequest(headers)).not.toThrow();
    headers.set("origin", "https://foreign.example");
    expect(() => assertStudioRequest(headers)).toThrow();
  });

  it("never trusts a spoofed localhost Host in production: a generated code is required", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TROUPE_ACCESS_CODE", "");
    expect(() => assertStudioRequest(new Headers({ host: "localhost:3000" }))).toThrow(/access code/i);
    const code = currentAccessCode()!;
    expect(code).toBeTruthy();
    expect(() => assertStudioRequest(withCookie({ host: "localhost:3000" }, code))).not.toThrow();
  });

  it("lets loopback requests in without a code only outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("TROUPE_ACCESS_CODE", "");
    expect(() => assertStudioRequest(new Headers({ host: "localhost:3000" }))).not.toThrow();
    expect(() => assertStudioRequest(new Headers({ host: "troupe.example" }))).toThrow();
  });

  it("fails closed on Vercel without a configured code", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("TROUPE_ACCESS_CODE", "");
    expect(() => assertStudioRequest(new Headers({ host: "localhost:3000" }))).toThrow();
  });

  it("works behind a TLS reverse proxy that rewrites Host", () => {
    vi.stubEnv("TROUPE_ACCESS_CODE", "proxied");
    const headers = withCookie({ host: "app:3000", "x-forwarded-host": "troupe.example", "x-forwarded-proto": "https", origin: "https://troupe.example" }, "proxied");
    expect(() => assertStudioRequest(headers)).not.toThrow();
  });

  it("sets a secure HttpOnly cookie only after the correct code", async () => {
    vi.stubEnv("TROUPE_ACCESS_CODE", "fixture-access-code"); vi.stubEnv("NODE_ENV", "production");
    const request = (code: string) => new Request("https://troupe.example/api/access", { method: "POST", headers: { host: "troupe.example", origin: "https://troupe.example" }, body: JSON.stringify({ code }) });
    expect((await POST(request("wrong"))).status).toBe(401);
    const response = await POST(request("fixture-access-code"));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/);
    expect(response.headers.get("set-cookie")).toMatch(/Secure/);
    expect(response.headers.get("set-cookie")).not.toContain("fixture-access-code");
    expect((await POST(request("a".repeat(2100)))).status).toBe(413);
  });

  it("slows down guessing: after 5 wrong codes from one address, even the right code waits", async () => {
    vi.stubEnv("TROUPE_ACCESS_CODE", "rate-limited-code"); vi.stubEnv("NODE_ENV", "production");
    const request = (code: string, ip: string) => new Request("https://troupe.example/api/access", { method: "POST", headers: { host: "troupe.example", origin: "https://troupe.example", "x-forwarded-for": ip }, body: JSON.stringify({ code }) });
    for (let i = 0; i < 5; i++) expect((await POST(request(`wrong-${i}`, "203.0.113.7"))).status).toBe(401);
    const blocked = await POST(request("rate-limited-code", "203.0.113.7"));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect((await POST(request("rate-limited-code", "198.51.100.2"))).status).toBe(200);
  });

  it("marks the cookie Secure when a proxy terminated TLS", async () => {
    vi.stubEnv("TROUPE_ACCESS_CODE", "code"); vi.stubEnv("NODE_ENV", "production");
    const response = await POST(new Request("http://app:3000/api/access", {
      method: "POST",
      headers: { host: "app:3000", "x-forwarded-host": "troupe.example", "x-forwarded-proto": "https", origin: "https://troupe.example" },
      body: JSON.stringify({ code: "code" }),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/Secure/);
  });
});
