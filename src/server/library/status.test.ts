import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createServerLibrary } = await import("./index");

// The tools' readiness is cached for a few seconds, per set of settings: a
// studio built from other settings (a test, a second workspace process)
// never reads another's answer.

let dir: string;
let fakeYtDlp: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "troupe-status-"));
  fakeYtDlp = join(dir, "yt-dlp");
  await writeFile(fakeYtDlp, "#!/bin/sh\necho 2026.01.01\n");
  await chmod(fakeYtDlp, 0o755);
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const quiet = { TROUPE_LIBRARY_EMBED_MODEL: "off", TROUPE_LIBRARY_VISION_MODEL: "off" };
const videoLinks = async (env: Record<string, string>) => {
  const library = createServerLibrary(null as never, null, { env: { ...quiet, ...env } })!;
  return (await library.status()).tools.find((t) => t.name === "video-links")!;
};

describe("the library's tool status", () => {
  it("says video links are off when they are turned off, and does not reuse that answer for other settings", async () => {
    expect(await videoLinks({ TROUPE_YTDLP_PATH: "off" })).toMatchObject({ ready: false, detail: expect.stringContaining("TROUPE_YTDLP_PATH=off") });
    expect(await videoLinks({ TROUPE_YTDLP_PATH: fakeYtDlp })).toMatchObject({ ready: true, model: "yt-dlp 2026.01.01" });
    expect(await videoLinks({ TROUPE_YTDLP_PATH: join(dir, "missing") })).toMatchObject({ ready: false, detail: expect.stringContaining("not installed") });
  });
});
