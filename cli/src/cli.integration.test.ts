import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("~/server/media/supabase", () => ({ uploadToSupabase: vi.fn(async () => false) }));
// The studio's real route handlers, on an in-memory Postgres.
vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("~/test/db");
  return { db: (await createTestDb()).db };
});

import type { NextRequest } from "next/server";
import { POST as accessPost } from "~/app/api/access/route";
import { GET as healthGet } from "~/app/api/health/route";
import { POST as libraryUploadPost } from "~/app/api/library/upload/route";
import { GET as mediaGet } from "~/app/api/media/[assetId]/route";
import { POST as trpcPost, GET as trpcGet } from "~/app/api/trpc/[trpc]/route";
import { json, startServer } from "~/test/local-server";

import { runCli } from "./cli.ts";
import type { Io } from "./command.ts";

const CODE = "open-sesame-cli";

// Node's http server in front of the Next route handlers, as `next start`
// would put them.
async function toRequest(req: IncomingMessage, base: string): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers))
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(new URL(req.url ?? "/", base), {
    method: req.method,
    headers,
    ...(hasBody ? { body: Buffer.concat(chunks) } : {}),
  });
}

async function reply(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") res.setHeader(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader("set-cookie", cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function startStudio(): Promise<{ url: string; server: Server }> {
  let base = "";
  const server = createServer((req, res) => {
    void (async () => {
      const request = await toRequest(req, base);
      const path = new URL(request.url).pathname;
      const media = /^\/api\/media\/([^/]+)$/.exec(path);
      if (path === "/api/health") return reply(res, await healthGet());
      if (path === "/api/access" && request.method === "POST") return reply(res, await accessPost(request));
      if (path.startsWith("/api/trpc/"))
        return reply(res, await (request.method === "GET" ? trpcGet : trpcPost)(request as NextRequest));
      if (media) return reply(res, await mediaGet(request, { params: Promise.resolve({ assetId: media[1]! }) }));
      if (path === "/api/library/upload" && request.method === "POST")
        return reply(res, await libraryUploadPost(request));
      res.statusCode = 404;
      res.end("not found");
    })().catch((error: unknown) => {
      res.statusCode = 500;
      res.end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url: base, server };
}

let studio: { url: string; server: Server };
let model: Awaited<ReturnType<typeof startServer>>;
let ollama: Awaited<ReturnType<typeof startServer>>;
let folder: string;
let clip: Buffer;

beforeAll(async () => {
  // The studio's per-procedure timing lines (development mode).
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  folder = await mkdtemp(join(tmpdir(), "troupe-cli-"));
  clip = await readFile("src/test/fixtures/clip.mp4");
  vi.stubEnv("TROUPE_ACCESS_CODE", CODE);
  vi.stubEnv("TROUPE_DATA_DIR", join(folder, "data"));
  vi.stubEnv("TROUPE_SECRET", "cli-integration");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("GOOGLE_GENAI_API_KEY", "");
  vi.stubEnv("FAL_KEY", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  // A video model speaking the HTTP contract, finished as soon as it is asked.
  let jobs = 0;
  model = await startServer((r, res) => {
    if (r.path === "/health") return json(res, 200, { ok: true, contract: 1, poll_every_s: 1 });
    if (r.method === "POST" && r.path === "/jobs") return json(res, 200, { id: `job-${++jobs}` });
    const job = /^\/jobs\/(job-\d+)$/.exec(r.path);
    if (job) return json(res, 200, { status: "succeeded", video_url: `/out/${job[1]}.mp4` });
    if (/^\/out\/job-\d+\.mp4$/.test(r.path)) {
      res.writeHead(200, { "content-type": "video/mp4" });
      res.end(clip);
      return;
    }
    json(res, 404, {});
  });
  // Ollama, answering each request in the shape its schema asks for: the
  // same shorter script, the library's analysis, answers and ideas, and
  // bag-of-words embeddings.
  ollama = await startServer((r, res) => {
    if (r.path === "/api/tags")
      return json(res, 200, { models: [{ name: "qwen3:4b" }, { name: "all-minilm:latest" }] });
    if (r.path === "/api/embed") {
      const input = (JSON.parse(r.body) as { input: string[] }).input;
      return json(res, 200, {
        embeddings: input.map((t) =>
          ["coffee", "jacket", "hook", "pocket", "follow"].map((w) => (t.toLowerCase().includes(w) ? 1 : 0.01)),
        ),
      });
    }
    if (r.path === "/api/chat") {
      const required = ((JSON.parse(r.body) as { format?: { required?: string[] } }).format?.required ?? []).join(",");
      const answer = required.includes("hook_why")
        ? {
            summary: "A packable jacket, shown in one move.",
            hook_why: "It dares the viewer to keep scrolling.",
            structure: [{ part: "hook", start_s: 0, summary: "The dare" }],
            tone: ["direct"],
            tags: ["jacket", "travel"],
          }
        : required.includes("answer")
          ? { answer: "It opens on a dare about the pocket [1].", sources: [1] }
          : required.includes("ideas")
            ? {
                ideas: [
                  {
                    title: "Pocket test",
                    hook: "Can your jacket do this?",
                    lines: [
                      { role: "hook", text: "Can your jacket do this?", emotion: "excited" },
                      { role: "cta", text: "Follow for the next test.", emotion: "happy" },
                    ],
                  },
                ],
              }
            : {
                summary: "A shorter hook.",
                lines: [
                  { role: "hook", text: "Stop scrolling.", emotion: "excited" },
                  { role: "cta", text: "Follow for more.", emotion: "calm" },
                ],
                actor: null,
              };
      return json(res, 200, { message: { role: "assistant", content: JSON.stringify(answer) } });
    }
    json(res, 404, {});
  });
  vi.stubEnv("OLLAMA_URL", ollama.url);
  // The library: embeddings on the fake Ollama, no vision, transcription or
  // yt-dlp here (each a warning in doctor, the same on every machine).
  vi.stubEnv("TROUPE_LIBRARY_EMBED_MODEL", "all-minilm");
  vi.stubEnv("TROUPE_LIBRARY_VISION_MODEL", "off");
  vi.stubEnv("TROUPE_TRANSCRIBE_URL", "");
  vi.stubEnv("TROUPE_YTDLP_PATH", join(tmpdir(), "no-yt-dlp-here"));
  studio = await startStudio();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((resolve) => studio.server.close(() => resolve()));
  await model.close();
  await ollama.close();
  await rm(folder, { recursive: true, force: true });
});

// One CLI invocation, in process, with its own environment.
async function troupe(args: string[], opts: { stdin?: string; env?: Record<string, string>; typed?: string } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    env: { TROUPE_CONFIG_DIR: join(folder, "config"), ...opts.env },
    cwd: folder,
    stdout: (text) => void out.push(text),
    stderr: (text) => void err.push(text),
    readStdin: async () => {
      if (opts.typed !== undefined) throw new Error("stdin is a terminal: it must not be read in clear");
      return opts.stdin ?? "";
    },
    // `typed`: stdin is a terminal and this is what the user types at the hidden prompt.
    stdinIsTTY: opts.typed !== undefined,
    stderrIsTTY: false,
    promptSecret: async () => {
      if (opts.typed === undefined) throw new Error("no terminal in tests");
      return opts.typed;
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 100))),
  };
  const code = await runCli(args, io);
  const stdout = out.join("");
  return { code, stdout, stderr: err.join(""), data: () => JSON.parse(stdout) };
}

describe("troupe CLI against the studio's HTTP API", () => {
  it("signs in, writes a script, chats, renders, watches, downloads and exports", async () => {
    // Not signed in yet: the API refuses, with the auth exit status.
    const anonymous = await troupe(["projects", "list", "--url", studio.url, "--json"]);
    expect(anonymous.code).toBe(3);
    expect(JSON.parse(anonymous.stderr)).toMatchObject({ error: { code: "UNAUTHORIZED", exitCode: 3 } });

    expect((await troupe(["login", "--url", studio.url, "--code-stdin"], { stdin: "wrong-code" })).code).toBe(3);
    // --code-stdin wins over TROUPE_ACCESS_CODE.
    const login = await troupe(["login", "--url", studio.url, "--code-stdin", "--json"], {
      stdin: `${CODE}\n`,
      env: { TROUPE_ACCESS_CODE: "stale-code" },
    });
    expect(login.code).toBe(0);
    expect(login.data()).toEqual({ profile: "default", url: studio.url, access: "code" });
    // On a terminal, --code-stdin asks without echo instead of reading stdin.
    expect((await troupe(["login", "--url", studio.url, "--code-stdin"], { typed: CODE })).code).toBe(0);
    // The cookie is saved for its owner only, and the code never is.
    const configFile = join(folder, "config", "config.json");
    expect((await stat(configFile)).mode & 0o777).toBe(0o600);
    expect(await readFile(configFile, "utf8")).not.toContain(CODE);

    const added = await troupe([
      "models",
      "add",
      "http",
      "--name",
      "Test renderer",
      "--base-url",
      model.url,
      "--durations",
      "4,8",
      "--audio",
      "optional",
      "--default",
      "--json",
    ]);
    expect(added.code).toBe(0);
    const { modelKey } = added.data();
    expect(added.data().test).toMatchObject({ ok: true, pollEveryS: 1 });

    const doctor = await troupe(["doctor", "--json"]);
    expect(doctor.data().checks.map((c: { name: string; status: string }) => [c.name, c.status])).toEqual([
      ["studio", "ok"],
      ["sign-in", "ok"],
      ["models", "ok"],
      [`model ${modelKey}`, "ok"],
      ["worker", "warn"],
      ["chat", "ok"],
      ["library transcription", "warn"],
      ["library vision", "warn"],
      ["library embeddings", "ok"],
      ["library writer", "ok"],
      ["library links", "ok"],
      ["library video-links", "warn"],
    ]);
    expect(doctor.code).toBe(0);

    const actors = (await troupe(["actors", "list", "--json"])).data();
    const actor = actors.find((a: { status: string }) => a.status === "active");
    const created = await troupe(["projects", "create", "--title", "CLI walk", "--actor", actor.name, "--json"]);
    expect(created.code).toBe(0);
    expect(created.data()).toMatchObject({ title: "CLI walk", actorId: actor.id, platform: "tiktok", format: "9:16" });

    // Emotions from the file; untagged lines stay neutral. One version.
    await writeFile(
      join(folder, "script.txt"),
      "# draft\n[excited] Stop scrolling: this jacket packs into its own pocket.\nIt weighs almost nothing.\n[calm] Tap the link.\n",
    );
    const set = await troupe(["script", "set", "script.txt", "--json"]);
    expect(set.code).toBe(0);
    expect(set.data()).toMatchObject({
      version: 1,
      lines: [
        { role: "hook", emotion: "excited" },
        { role: "body", emotion: "neutral" },
        { role: "cta", emotion: "calm" },
      ],
    });
    expect((await troupe(["script", "show", "--text"])).stdout).toContain(
      "[excited] Stop scrolling: this jacket packs into its own pocket.",
    );
    expect((await troupe(["script", "versions", "--json"])).data()).toHaveLength(1);

    const sent = await troupe(["chat", "send", "make", "it", "shorter", "--json"]);
    expect(sent.code).toBe(0);
    expect(sent.data().proposal.lines).toHaveLength(2);
    const applied = await troupe(["chat", "apply", "--json"]);
    expect(applied.data().script).toMatchObject({ version: 2, origin: "chat" });

    // A clip shorter than the script is refused before anything is sent.
    const tooShort = await troupe(["render", "launch", "--duration", "1", "--json"]);
    expect(tooShort.code).toBe(1);
    expect(JSON.parse(tooShort.stderr).error.code).toBe("SCRIPT_TOO_LONG");
    const launched = await troupe(["render", "launch", "--json"]);
    expect(launched.code).toBe(0);
    expect(launched.data()).toMatchObject({
      modelKey,
      resolution: "720p",
      status: expect.stringMatching(/queued|in_progress/),
    });
    const watched = await troupe(["render", "watch", "--interval", "0.05", "--timeout", "30", "--json"]);
    expect(watched.code).toBe(0);
    expect(watched.data()).toMatchObject({ id: launched.data().id, status: "completed" });

    const saved = await troupe(["download", "-o", "renders/", "--json"]);
    expect(saved.code).toBe(0);
    expect(saved.data().path).toMatch(/renders\/cli-walk-test-renderer-\d{4}-\d{2}-\d{2}-\d{4}\.mp4$/);
    expect(await readFile(saved.data().path)).toEqual(clip);
    // An existing file is kept unless --force: a refusal, exit 1.
    const kept = await troupe(["download", "-o", saved.data().path, "--json"]);
    expect(kept.code).toBe(1);
    expect(JSON.parse(kept.stderr).error.code).toBe("FILE_EXISTS");
    expect((await troupe(["download", "-o", saved.data().path, "--force"])).code).toBe(0);

    expect((await troupe(["export", "create", "--caption", "Spring"])).code).toBe(2);
    const exported = await troupe([
      "export",
      "create",
      "--caption",
      "Spring",
      "--hashtag",
      "jacket",
      "--confirm-watched",
      "--json",
    ]);
    expect(exported.code).toBe(0);
    expect(exported.data()).toMatchObject({
      platform: "tiktok",
      caption: "Spring",
      hashtags: ["#jacket"],
      disclosure: { requirement: "toggle" },
    });
    const listed = await troupe(["export", "list", "--json"]);
    expect(listed.data().map((e: { id: string }) => e.id)).toEqual([exported.data().id]);
    const exportFile = await troupe(["download", exported.data().id.slice(0, 8), "-o", "export.mp4", "--json"]);
    expect(exportFile.data()).toMatchObject({ exportId: exported.data().id, path: join(folder, "export.mp4") });
    expect(await readFile(join(folder, "export.mp4"))).toEqual(clip);

    expect((await troupe(["logout"])).code).toBe(0);
    expect((await troupe(["render", "list"])).code).toBe(3);
    // TROUPE_ACCESS_CODE signs a command in without a saved cookie.
    expect((await troupe(["render", "list", "--json"], { env: { TROUPE_ACCESS_CODE: CODE } })).data()).toHaveLength(1);
  });

  it("checks provider keys for free, and renders one clip per model only with --yes", async () => {
    const signed = { env: { TROUPE_ACCESS_CODE: CODE } };
    const providers = await troupe(["doctor", "--providers", "--json"], signed);
    expect(providers.code).toBe(0);
    expect(providers.data().checks.filter((c: { name: string }) => c.name.startsWith("account "))).toEqual([
      { name: "account google", status: "skip", detail: "Google AI: no key (optional)." },
      { name: "account fal", status: "skip", detail: "fal.ai: no key (optional)." },
      { name: "account anthropic", status: "skip", detail: "Anthropic: no key (optional)." },
    ]);

    // The plan and its cost, and nothing launched: exit 2.
    const before = (await troupe(["projects", "list", "--json"], signed)).data().length;
    const plan = await troupe(["doctor", "--live", "--json"], signed);
    expect(plan.code).toBe(2);
    expect(plan.data().live).toEqual({
      confirmed: false,
      plans: [
        expect.objectContaining({
          label: "Test renderer",
          durationS: 4,
          resolution: "720p",
          audio: false,
          estimateUsd: 0,
        }),
      ],
    });
    expect((await troupe(["projects", "list", "--json"], signed)).data()).toHaveLength(before);
    expect((await troupe(["doctor", "--live"], signed)).stdout).toContain("Nothing was launched");

    const live = await troupe(["doctor", "--live", "--yes", "--interval", "0.05", "-o", "live", "--json"], signed);
    expect(live.code).toBe(0);
    const { results, chat, folder: out } = live.data().live;
    expect(out).toBe(join(folder, "live"));
    expect(results).toEqual([
      expect.objectContaining({
        label: "Test renderer",
        status: "completed",
        file: join(folder, "live", `${results[0].modelKey}.mp4`),
        probe: expect.objectContaining({ codec: "h264" }),
      }),
    ]);
    expect(await readFile(results[0].file)).toEqual(clip);
    expect(chat).toEqual({ ok: true, detail: "ollama (qwen3:4b) proposed a script." });
  });

  it("saves text and a video to the library, searches it, asks it and turns an idea into a project", async () => {
    const signed = { env: { TROUPE_ACCESS_CODE: CODE } };
    const text = await troupe(["library", "add", "-", "--mine", "--wait", "--json"], {
      ...signed,
      stdin: "This jacket packs into its own pocket.\nFollow for the next test.",
    });
    expect(text.code).toBe(0);
    expect(text.data()).toMatchObject({
      kind: "text",
      mine: true,
      status: "ready",
      tags: ["jacket", "travel"],
      analysis: { hook: { text: "This jacket packs into its own pocket." } },
    });

    await writeFile(join(folder, "pocket.mp4"), clip);
    const video = await troupe(["library", "add", "pocket.mp4", "--title", "Pocket clip", "--wait", "--json"], signed);
    expect(video.code).toBe(0);
    expect(video.data()).toMatchObject({
      kind: "video",
      title: "Pocket clip",
      fileName: "pocket.mp4",
      status: "ready",
    });
    // ffmpeg took its opening picture; no transcription here, which it says.
    expect(video.data().analysis.frames.length).toBeGreaterThan(0);
    expect(video.data().problem).toContain("Skipped: the transcript.");
    // An HTML page is not a file the library takes.
    await writeFile(join(folder, "page.html"), "<html><script>alert(1)</script></html>");
    const refused = await troupe(["library", "add", "page.html", "--json"], signed);
    expect(refused.code).toBe(1);
    expect(JSON.parse(refused.stderr).error.message).toContain("not one the library reads");

    const listed = (await troupe(["library", "list", "--json"], signed)).data();
    expect(listed.map((i: { title: string }) => i.title)).toEqual([
      "Pocket clip",
      "This jacket packs into its own pocket.",
    ]);
    expect((await troupe(["library", "show", "pocket clip"], signed)).stdout).toMatch(/Kind:\s+video/);

    const found = (await troupe(["library", "search", "jacket", "pocket", "--json"], signed)).data();
    expect(found.mode).toBe("semantic");
    expect(found.hits[0].itemId).toBe(text.data().id);

    const answered = await troupe(
      ["library", "chat", "--item", text.data().id.slice(0, 8), "how", "does", "it", "open?"],
      signed,
    );
    expect(answered.stdout).toContain("It opens on a dare about the pocket [1].");
    expect(answered.stdout).toMatch(
      /\[1\] This jacket packs into its own pocket\. \(troupe library show [0-9a-f]{8}\)/,
    );

    const written = await troupe(["library", "ideas", "generate", "--item", text.data().id, "--json"], signed);
    expect(written.code).toBe(0);
    expect(written.data()).toEqual([
      expect.objectContaining({
        title: "Pocket test",
        kind: "ideas",
        lines: [expect.objectContaining({ role: "hook" }), expect.objectContaining({ role: "cta" })],
      }),
    ]);
    const made = await troupe(
      ["library", "ideas", "project", "pocket test", "--platform", "instagram", "--json"],
      signed,
    );
    expect(made.data()).toMatchObject({ created: true });
    const script = (await troupe(["script", "show", "--project", made.data().projectId, "--json"], signed)).data();
    expect(script).toMatchObject({ version: 1, origin: "chat" });
    expect((await troupe(["library", "ideas"], signed)).stdout).toContain(
      `(project ${made.data().projectId.slice(0, 8)})`,
    );
  });
});
