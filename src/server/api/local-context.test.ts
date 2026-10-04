import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { assertLocalRequest } from "./local-context";

describe("personal studio request boundary", () => {
  it.each(["localhost:3100", "127.0.0.1:3000", "[::1]:3000"])("accepts the local studio at %s", (host) => {
    expect(() => assertLocalRequest(new Headers({ host, origin: `http://${host}` }))).not.toThrow();
  });
  it.each([
    {},
    { host: "evil.example" },
    { host: "localhost.evil.example" },
    { host: "localhost:3100", origin: "https://evil.example" },
    { host: "localhost:3100", origin: "http://localhost:4000" },
    { host: "localhost:3100", origin: "null" },
    { host: "localhost:3100", "sec-fetch-site": "cross-site" },
  ])("rejects foreign or malformed browser requests: %j", (values) => {
    expect(() => assertLocalRequest(new Headers(values as Record<string, string>))).toThrow();
  });
});
