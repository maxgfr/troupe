import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createServerLibrary } = await import("./index");
const { json, startServer } = await import("~/test/local-server");

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
    expect(await videoLinks({ TROUPE_YTDLP_PATH: "off" })).toMatchObject({
      ready: false,
      detail: expect.stringContaining("TROUPE_YTDLP_PATH=off"),
    });
    expect(await videoLinks({ TROUPE_YTDLP_PATH: fakeYtDlp })).toMatchObject({
      ready: true,
      model: "yt-dlp 2026.01.01",
    });
    expect(await videoLinks({ TROUPE_YTDLP_PATH: join(dir, "missing") })).toMatchObject({
      ready: false,
      detail: expect.stringContaining("not installed"),
    });
  });
});

describe("the library's transcription status", () => {
  // A renderer that is busy (a render on a small machine) can miss one health
  // check: the next status asks again instead of repeating that miss for the
  // whole cache period, so `troupe doctor` right after a render sees it ready.
  it("asks the renderer again after a failed health check instead of keeping the failure", async () => {
    let answered = 0;
    const renderer = await startServer((req, res) => {
      if (req.path !== "/transcribe/health") return json(res, 404, {});
      answered++;
      return answered === 1
        ? json(res, 503, { ok: false, error: "Busy." })
        : json(res, 200, { ok: true, model: "faster-whisper tiny" });
    });
    try {
      const library = createServerLibrary(null as never, null, {
        env: { ...quiet, TROUPE_YTDLP_PATH: "off", TROUPE_TRANSCRIBE_URL: renderer.url },
      })!;
      const transcription = async () => (await library.status()).tools.find((t) => t.name === "transcription")!;
      expect(await transcription()).toMatchObject({ ready: false, detail: expect.stringContaining("Busy.") });
      expect(await transcription()).toMatchObject({ ready: true, model: "faster-whisper tiny" });
      // A ready answer is kept: no third question within the cache period.
      await transcription();
      expect(answered).toBe(2);
    } finally {
      await renderer.close();
    }
  });
});
