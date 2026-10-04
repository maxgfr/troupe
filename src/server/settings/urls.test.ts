import { describe, expect, it } from "vitest";

import { checkLocalUrl, sameOrigin } from "./urls";

describe("checkLocalUrl", () => {
  it.each([
    "http://127.0.0.1:8188",
    "http://localhost:8000/",
    "http://host.docker.internal:8188",
    "http://comfyui:8188",
    "http://192.168.1.20:8188",
    "http://10.0.0.5",
    "https://gpu.example.com/api",
    "http://[::1]:8000",
  ])("accepts %s", (raw) => {
    expect(checkLocalUrl(raw)).toMatchObject({ ok: true });
  });

  it.each([
    ["ftp://192.168.1.2/", /http/],
    ["file:///etc/passwd", /http/],
    ["http://user:pass@192.168.1.2", /credentials/],
    ["http://169.254.169.254/latest/meta-data", /link-local|metadata/i],
    ["http://169.254.10.1", /link-local/i],
    ["http://[fe80::1]:8000", /link-local/i],
    ["http://metadata.google.internal", /metadata/],
    ["http://100.100.100.200", /metadata/],
    ["http://[fd00:ec2::254]", /metadata/],
    ["http://[::ffff:169.254.169.254]/", /link-local|metadata/i],
    ["http://[::ffff:a9fe:a9fe]/", /link-local|metadata/i],
    ["http://metadata.google.internal./", /metadata/],
    ["http://0.0.0.0:8000", /address/],
    ["not a url", /valid URL/],
  ])("refuses %s", (raw, reason) => {
    const result = checkLocalUrl(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(reason);
  });

  it("normalises the base URL without a trailing slash", () => {
    expect(checkLocalUrl("http://comfyui:8188/")).toEqual({ ok: true, base: "http://comfyui:8188" });
    expect(checkLocalUrl("https://gpu.example.com/api/")).toEqual({ ok: true, base: "https://gpu.example.com/api" });
  });
});

describe("sameOrigin", () => {
  it("compares scheme, host and port", () => {
    expect(sameOrigin("http://gpu:8000/out/a.mp4", "http://gpu:8000")).toBe(true);
    expect(sameOrigin("http://gpu:9000/out/a.mp4", "http://gpu:8000")).toBe(false);
    expect(sameOrigin("https://gpu:8000/a.mp4", "http://gpu:8000")).toBe(false);
    expect(sameOrigin("not a url", "http://gpu:8000")).toBe(false);
  });
});
