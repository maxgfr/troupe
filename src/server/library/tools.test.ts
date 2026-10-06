import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { json, startServer } from "~/test/local-server";
import { createTestDb } from "~/test/db";
import { mediaFilePath } from "~/server/media/storage";
import { libraryEnvironment } from "./config";
import { fetchSource } from "./fetch";
import { receiveUpload } from "./files";
import { frameTimes, cutsFromDifferences } from "~/modules/library";
import { cutTimes, inputArgs, serverMediaReader } from "./media";
import { embeddingPrefixes, ollamaEmbedder, ollamaVision, pulledModels } from "./ollama";
import { rendererTranscriber, transcriberHealth } from "./transcribe";

const DATA = mkdtempSync(join(tmpdir(), "troupe-library-test-"));
const previousDataDir = process.env.TROUPE_DATA_DIR;
let server: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  process.env.TROUPE_DATA_DIR = DATA;
  server = await startServer((req, res) => {
    if (req.path === "/api/tags") return json(res, 200, { models: [{ name: "all-minilm:latest", model: "all-minilm:latest" }] });
    if (req.path === "/api/embed") {
      const body = JSON.parse(req.body) as { input: string[] };
      return json(res, 200, { embeddings: body.input.map((t) => [t.length, 1]) });
    }
    if (req.path === "/api/chat") return json(res, 200, { message: { content: JSON.stringify({ description: "  A jar of coffee on a table. ", text: "COLD BREW" }) } });
    if (req.path === "/transcribe/health") return req.headers.authorization === "Bearer t0ken" ? json(res, 200, { ok: true, model: "faster-whisper base" }) : json(res, 401, { error: "unauthorized" });
    if (req.path === "/transcribe") return json(res, 200, { language: "en", model: "faster-whisper base", segments: [{ start: 0, end: 1.5, text: " Hello there. " }, { start: 1.5, end: 2, text: "" }] });
    if (req.path === "/article") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return void res.end(`<html><head><title>Hooks</title></head><body><article><h1>Hooks</h1><p>${"A good hook names a problem the viewer has. ".repeat(10)}</p></article></body></html>`);
    }
    if (req.path === "/clip.mp4") {
      res.writeHead(200, { "content-type": "video/mp4" });
      return void res.end(Buffer.from([0, 0, 0, 0x18, ...Buffer.from("ftypmp42"), 0, 0, 0, 0]));
    }
    if (req.path === "/zip") {
      res.writeHead(200, { "content-type": "application/zip" });
      return void res.end("PK");
    }
    if (req.path === "/to-metadata") {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" });
      return void res.end();
    }
    json(res, 404, {});
  });
});

afterAll(async () => {
  await server.close();
  rmSync(DATA, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.TROUPE_DATA_DIR;
  else process.env.TROUPE_DATA_DIR = previousDataDir;
});

describe("Ollama for the library", () => {
  it("lists pulled models and embeds with the model's prefixes", async () => {
    const target = { baseUrl: server.url, timeoutMs: 5000 };
    expect(await pulledModels(target)).toEqual(new Set(["all-minilm:latest"]));
    const vectors = await ollamaEmbedder(target, "nomic-embed-text").embed(["abc", "de"], "passage");
    expect(vectors).toEqual([[`search_document: abc`.length, 1], [`search_document: de`.length, 1]]);
    expect(JSON.parse(server.requests.at(-1)!.body)).toMatchObject({ model: "nomic-embed-text", truncate: true });
    expect(embeddingPrefixes("qwen3-embedding:0.6b").query).toMatch(/^Instruct: .*\nQuery: $/s);
    expect(embeddingPrefixes("all-minilm")).toEqual({ query: "", passage: "" });
  });

  it("asks the vision model for a description and the words in the picture", async () => {
    const seen = await ollamaVision({ baseUrl: server.url, timeoutMs: 5000 }, "qwen3-vl:2b-instruct").read({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" }, {});
    expect(seen).toEqual({ description: "A jar of coffee on a table.", text: "COLD BREW" });
    const sent = JSON.parse(server.requests.at(-1)!.body);
    expect(sent).toMatchObject({ model: "qwen3-vl:2b-instruct", stream: false, think: false, format: { required: ["description", "text"] } });
    expect(sent.messages[0].images).toEqual([Buffer.from([1, 2, 3]).toString("base64")]);
  });

  it("drops on-screen text that only repeats the instructions", async () => {
    const echo = await startServer((_req, res) => json(res, 200, { message: { content: JSON.stringify({ description: "A runner in an alley.", text: "the people, objects and setting, and how" }) } }));
    expect(await ollamaVision({ baseUrl: echo.url, timeoutMs: 5000 }, "qwen3-vl:2b-instruct").read({ bytes: new Uint8Array([1]), mimeType: "image/jpeg" }, {})).toEqual({ description: "A runner in an alley.", text: "" });
    await echo.close();
  });

  it("refuses an Ollama address that is not allowed", async () => {
    await expect(pulledModels({ baseUrl: "http://169.254.169.254", timeoutMs: 1000 })).rejects.toThrow("not allowed");
  });
});

describe("transcription on the renderer", () => {
  it("checks the token and reads timed segments", async () => {
    expect(await transcriberHealth({ baseUrl: server.url, token: "wrong", timeoutMs: 5000 })).toEqual({ ok: false, problem: "The renderer refused the token (TROUPE_TRANSCRIBE_TOKEN)." });
    expect(await transcriberHealth({ baseUrl: server.url, token: "t0ken", timeoutMs: 5000 })).toEqual({ ok: true, model: "faster-whisper base" });
    const dir = mkdtempSync(join(tmpdir(), "troupe-audio-test-"));
    writeFileSync(join(dir, "a.flac"), "fLaC");
    const transcript = await rendererTranscriber({ baseUrl: server.url, token: "t0ken", timeoutMs: 5000 }, "whisper").transcribe({ kind: "file", path: join(dir, "a.flac") }, {});
    expect(transcript).toEqual({ language: "en", model: "faster-whisper base", segments: [{ startS: 0, endS: 1.5, text: "Hello there." }] });
    expect(server.requests.at(-1)!.headers).toMatchObject({ authorization: "Bearer t0ken", "content-type": "audio/flac" });
    rmSync(dir, { recursive: true });
  });
});

describe("saving links", () => {
  const env = (allow: boolean) => libraryEnvironment({ TROUPE_LIBRARY_ALLOW_PRIVATE_URLS: allow ? "1" : "0", TROUPE_LIBRARY_MAX_UPLOAD_MB: "1" });

  it("refuses this server's own addresses unless allowed on purpose", async () => {
    await expect(fetchSource(`${server.url}/article`, env(false))).rejects.toThrow(/this server or your network|this server itself/);
  });

  it("keeps a page's article, a direct file, and refuses other types", async () => {
    const article = await fetchSource(`${server.url}/article`, env(true));
    expect(article).toMatchObject({ kind: "article", title: "Hooks" });
    expect(article.kind === "article" && article.text).toContain("A good hook names a problem");
    const file = await fetchSource(`${server.url}/clip.mp4`, env(true));
    expect(file).toMatchObject({ kind: "file", title: "clip", mimeType: "video/mp4", bytes: 16 });
    if (file.kind === "file") await file.dispose();
    await expect(fetchSource(`${server.url}/zip`, env(true))).rejects.toThrow("application/zip");
  });

  it("checks every redirect: one to a metadata address is refused", async () => {
    await expect(fetchSource(`${server.url}/to-metadata`, env(true))).rejects.toThrow(/link-local|metadata/);
  });
});

describe("receiving uploads", () => {
  it("names the file by its bytes, keeps text as text, and stops past the limit", async () => {
    const mp4 = await receiveUpload(Readable.from([Buffer.from([0, 0, 0, 0x18, ...Buffer.from("ftypisom"), 1, 2, 3, 4])]), { itemId: "11111111-1111-4111-8111-111111111111", fileName: "my clip.MOV", maxBytes: 1000 });
    expect(mp4).toMatchObject({ kind: "file", file: { mimeType: "video/mp4", storagePath: "library/11111111-1111-4111-8111-111111111111/original.mp4", bytes: 16, fileName: "my clip.MOV" } });
    if (mp4.kind === "file") expect(readFileSync(mediaFilePath(mp4.file.storagePath)).length).toBe(16);
    expect(await receiveUpload(Readable.from([Buffer.from("Notes about hooks\n")]), { itemId: "22222222-2222-4222-8222-222222222222", fileName: "notes.txt", maxBytes: 1000 })).toEqual({ kind: "text", text: "Notes about hooks\n", fileName: "notes.txt" });
    await expect(receiveUpload(Readable.from([Buffer.from("<html><script>x</script>")]), { itemId: "33333333-3333-4333-8333-333333333333", fileName: "a.txt", maxBytes: 1000 })).rejects.toThrow("not one the library reads");
    await expect(receiveUpload(Readable.from([Buffer.alloc(600), Buffer.alloc(600)]), { itemId: "44444444-4444-4444-8444-444444444444", fileName: "big", maxBytes: 1000 })).rejects.toThrow("larger than");
  });
});

describe("ffmpeg's input", () => {
  it("reads local files only, with the demuxer of the type the file was sniffed as", () => {
    expect(inputArgs("video/mp4", "/data/a.mp4")).toEqual(["-protocol_whitelist", "file", "-f", "mov", "-i", "/data/a.mp4"]);
    expect(inputArgs("video/webm", "/d/b")).toEqual(["-protocol_whitelist", "file", "-f", "matroska", "-i", "/d/b"]);
    expect(inputArgs("audio/mpeg", "/d/c")).toEqual(["-protocol_whitelist", "file", "-f", "mp3", "-i", "/d/c"]);
    expect(inputArgs("audio/wav", "/d/d")).toContain("wav");
    // A type without a demuxer of its own is still read from a file only.
    expect(inputArgs("image/png", "/d/e")).toEqual(["-protocol_whitelist", "file", "-i", "/d/e"]);
  });
});

describe("frame times", () => {
  it("reads cut times from ffmpeg's showinfo log", () => {
    expect(cutTimes("[Parsed_showinfo_2 @ 0x1] n:   0 pts:  12288 pts_time:1.024 duration\n... pts_time:3.5 ...")).toEqual([1.024, 3.5]);
  });

  it("takes the opening, one after each cut, spread when there are too many, and a few across a video without cuts", () => {
    expect(frameTimes([0.4, 2, 5], 10, 12)).toEqual([0.5, 2.2, 5.2]);
    expect(frameTimes([], 20, 12)).toEqual([0.5, 5, 10, 15]);
    expect(frameTimes(Array.from({ length: 50 }, (_, i) => i + 1), 60, 4)).toHaveLength(4);
    expect(cutsFromDifferences([0.01, 0.4, 0.02, 0.3], 0.5)).toEqual([1, 2]);
  });
});

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasFfmpeg)("ffmpeg on a real video", () => {
  it("probes it, takes a picture after each cut and extracts its sound", async () => {
    const t = await createTestDb();
    const itemId = "55555555-5555-4555-8555-555555555555";
    const storagePath = `library/${itemId}/original.mp4`;
    // Two seconds of red, two of blue: one cut at 2 s, with a tone.
    execFileSync("mkdir", ["-p", join(DATA, "library", itemId)]);
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=red:s=320x240:d=2:r=10", "-f", "lavfi", "-i", "color=blue:s=320x240:d=2:r=10", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-filter_complex", "[0][1]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-map", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", mediaFilePath(storagePath)]);
    const reader = serverMediaReader(t.db, { ffmpegPath: "ffmpeg" });
    const item = { itemId, workspaceId: "66666666-6666-4666-8666-666666666666", assetId: "x", storagePath, mimeType: "video/mp4" };
    const probe = await reader.probe(item);
    expect(probe).toMatchObject({ hasVideo: true, hasAudio: true });
    expect(probe.durationS).toBeCloseTo(4, 0);
    const { frames, cutsAtS } = await reader.frames(item, { max: 12, durationS: probe.durationS });
    expect(cutsAtS).toHaveLength(1);
    expect(cutsAtS[0]).toBeCloseTo(2, 0);
    expect(frames.map((f) => f.atS)).toEqual([0.5, Math.round((cutsAtS[0]! + 0.2) * 100) / 100]);
    const picture = await reader.picture(frames[0]!.assetId);
    expect(picture.mimeType).toBe("image/jpeg");
    expect([...picture.bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    const audio = await reader.audio(item, {});
    expect(audio.kind === "file" && readFileSync(audio.path).subarray(0, 4).toString()).toBe("fLaC");
    await audio.dispose?.();
  }, 60_000);
});
