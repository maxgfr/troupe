import { chmod, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { mainHelp, runCli, VERSION } from "./cli.ts";
import cliPackage from "../package.json" with { type: "json" };
import { buildCli } from "../build.mjs";
import type { Io } from "./command.ts";
import { explainError, fetchMedia, USER_AGENT } from "./client.ts";
import { assertSecureTransport, LOCK_TIMING, normalizeUrl, readConfig, updateConfig, writeConfig } from "./config.ts";
import { startServer } from "~/test/local-server";
import { numberRanges, sentence, table } from "./output.ts";
import { pick } from "./resolve.ts";
import { modelState } from "./commands/models.ts";

const execFileAsync = promisify(execFile);
const folders: string[] = [];
// A port nothing listens on: taken from the OS, then released.
let closedPort = 0;
beforeAll(async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closedPort = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
afterEach(async () => {
  await Promise.all(folders.splice(0).map((f) => rm(f, { recursive: true, force: true })));
});

// The addresses `troupe open` handed to the browser; TEST_NO_BROWSER=1 makes
// none start.
const opened: string[] = [];

async function run(args: string[], env: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    // Nothing here reaches a studio.
    env: { TROUPE_URL: `http://127.0.0.1:${closedPort}`, TROUPE_CONFIG_DIR: "/nonexistent/troupe-cli-test", ...env },
    cwd: "/",
    stdout: (t) => void out.push(t),
    stderr: (t) => void err.push(t),
    readStdin: async () => "",
    stdinIsTTY: false,
    stderrIsTTY: false,
    promptSecret: async () => "",
    openUrl: async (url) => {
      if (env.TEST_NO_BROWSER === "1") return false;
      opened.push(url);
      return true;
    },
    sleep: async () => undefined,
  };
  const code = await runCli(args, io);
  return { code, stdout: out.join(""), stderr: err.join("") };
}

describe("troupe open", () => {
  it("opens the studio's Projects page, or only prints it with --print", async () => {
    opened.length = 0;
    const url = `http://127.0.0.1:${closedPort}/dashboard`;
    expect(await run(["open"])).toMatchObject({ code: 0, stdout: `${url}\n`, stderr: "" });
    expect(opened).toEqual([url]);
    expect(JSON.parse((await run(["open", "--print", "--json"])).stdout)).toEqual({ url, opened: false });
    expect(opened).toEqual([url]);
  });

  it("says so when no browser starts, and still prints the address", async () => {
    const result = await run(["open"], { TEST_NO_BROWSER: "1" });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("/dashboard");
    expect(result.stderr).toContain("No browser could be opened here");
  });
});

describe("command line", () => {
  it("prints help for the CLI, a group and a command, on stdout with status 0", async () => {
    expect(await run([])).toMatchObject({ code: 0, stdout: `${mainHelp()}\n` });
    const group = await run(["render", "--help"]);
    expect(group.code).toBe(0);
    expect(group.stdout).toContain("render watch [render]");
    const command = await run(["script", "set", "--help"]);
    expect(command.stdout).toMatch(/^Usage: troupe script set <file\|-> \[options\]/);
    expect(command.stdout).toContain("-p, --project <project>");
    expect(command.stdout).toContain("--json");
    expect((await run(["--version"])).stdout).toBe(`${cliPackage.version}\n`);
  });

  // The package.json files keep the last version set by hand (0.2.0, the
  // first tag); later releases are tags only, and their builds get the
  // version as TROUPE_VERSION (scripts/release-version.mjs).
  it("carries one baseline version in every package, which a source run reports", async () => {
    const root = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    const renderer = JSON.parse(await readFile(new URL("../../renderer/package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    expect([VERSION, USER_AGENT, renderer.version, cliPackage.version]).toEqual([
      root.version,
      `troupe-cli/${root.version}`,
      root.version,
      root.version,
    ]);
  });

  // A version in plugin.json would pin every user to it until a commit
  // changed it, and releases commit nothing: without one, Claude Code
  // versions the plugin by commit and updates it as main moves.
  it("leaves the Claude plugin unversioned, so it follows main", async () => {
    const plugin = JSON.parse(
      await readFile(new URL("../../skills/troupe/.claude-plugin/plugin.json", import.meta.url), "utf8"),
    ) as { version?: string };
    expect(plugin.version).toBeUndefined();
  });

  it("reports the release version its bundle was built with", async () => {
    const dir = await mkdtemp(join(tmpdir(), "troupe-cli-build-"));
    folders.push(dir);
    const built = await buildCli({ version: "v9.8.7", outfile: join(dir, "troupe.mjs") });
    expect(built.version).toBe("9.8.7");
    const { stdout } = await execFileAsync(process.execPath, [built.outfile, "--version"]);
    expect(stdout).toBe("9.8.7\n");
    // Compose's image tag is no version: package.json's.
    expect((await buildCli({ version: "latest", outfile: join(dir, "other.mjs") })).version).toBe(cliPackage.version);
  });

  it("finds the command after global options", async () => {
    const result = await run(["--json", "--profile", "x", "render", "list", "--help"]);
    expect(result.stdout).toMatch(/^Usage: troupe render list/);
  });

  it("refuses unknown commands, options and missing arguments with status 2", async () => {
    expect(await run(["render"])).toMatchObject({ code: 2, stdout: "" });
    expect((await run(["fly"])).stderr).toBe('troupe: Unknown command "fly". Run troupe --help for the list.\n');
    expect((await run(["projects", "list", "--colour"])).stderr).toContain("Unknown option '--colour'");
    expect((await run(["script", "set"])).stderr).toBe("troupe: Usage: troupe script set <file|->. See --help.\n");
    expect((await run(["projects", "list", "extra"])).code).toBe(2);
  });

  it("reports an unreachable studio with status 4, as JSON on stderr with --json", async () => {
    const result = await run(["projects", "list", "--json"]);
    expect(result.code).toBe(4);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        code: "UNREACHABLE",
        exitCode: 4,
        message: expect.stringContaining(`Cannot reach the studio at http://127.0.0.1:${closedPort} (ECONNREFUSED)`),
      },
    });
  });

  it("reads the standalone binary's network errors (Bun's) as unreachable too", () => {
    const refused = Object.assign(new TypeError("Unable to connect. Is the computer able to access the url?"), {
      code: "ConnectionRefused",
    });
    expect(explainError(refused, "http://127.0.0.1:9")).toMatchObject({ exitCode: 4, code: "UNREACHABLE" });
  });

  // docker-compose.yml passes TROUPE_PROJECT through, empty when unset: that
  // must not hide the project `projects create` or `projects use` saved.
  it("reads an empty TROUPE_PROJECT as unset and uses the saved project", async () => {
    const dir = await mkdtemp(join(tmpdir(), "troupe-cli-project-"));
    folders.push(dir);
    const env = { TROUPE_CONFIG_DIR: join(dir, "troupe") };
    const url = `http://127.0.0.1:${closedPort}`;
    await writeConfig(env, {
      profile: "default",
      profiles: { default: { url, project: "11111111-1111-4111-8111-111111111111" } },
    });
    const result = await run(["render", "list", "--json"], { ...env, TROUPE_PROJECT: "" });
    // Past choosing the project, on to the (closed) studio.
    expect(result.stderr).not.toContain("No project chosen");
    expect(result.code).toBe(4);
  });

  it("checks option values before calling the studio", async () => {
    expect(
      await run(["render", "watch", "--interval", "0"], { TROUPE_PROJECT: "11111111-1111-4111-8111-111111111111" }),
    ).toMatchObject({ code: 2, stderr: "troupe: --interval takes a number of seconds above 0.\n" });
    expect(
      (
        await run(["render", "launch", "--watch", "--timeout", "soon"], {
          TROUPE_PROJECT: "11111111-1111-4111-8111-111111111111",
        })
      ).code,
    ).toBe(2);
    const bad = await run([
      "models",
      "add",
      "http",
      "--name",
      "Box",
      "--base-url",
      "http://10.0.0.5:8000",
      "--durations",
      "4,x",
    ]);
    expect(bad).toMatchObject({
      code: 2,
      stderr: 'troupe: --durations takes whole seconds between 1 and 60, not "x".\n',
    });
    expect(
      (await run(["models", "add", "http", "--name", "Box", "--base-url", "http://10.0.0.5:8000", "--audio", "loud"]))
        .stderr,
    ).toContain("--audio takes one of always, optional, none");
    expect((await run(["projects", "list", "--url", "ftp://x"])).stderr).toContain(
      "Use an http:// or https:// address",
    );
  });
});

describe("studio address", () => {
  it("defaults to https, except on this machine", () => {
    expect(normalizeUrl("studio.example.com")).toBe("https://studio.example.com");
    expect(normalizeUrl("studio.example.com:8443/troupe/")).toBe("https://studio.example.com:8443/troupe");
    expect(normalizeUrl("localhost:3100")).toBe("http://localhost:3100");
    expect(normalizeUrl("127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(normalizeUrl("[::1]:3000")).toBe("http://[::1]:3000");
    expect(normalizeUrl("http://192.168.1.5:3100")).toBe("http://192.168.1.5:3100");
  });

  it("refuses plain http to another machine unless told the network is trusted", () => {
    expect(() => assertSecureTransport("http://studio.example.com", false)).toThrow(
      /studio\.example\.com would receive the access code and the studio's cookie unencrypted/,
    );
    expect(() => assertSecureTransport("http://localhost.example.com", false)).toThrow();
    expect(() => assertSecureTransport("http://192.168.1.5:3100", true)).not.toThrow();
    for (const url of [
      "https://studio.example.com",
      "http://127.0.0.1:3000",
      "http://127.3.0.1",
      "http://localhost:3100",
      "http://[::1]:3000",
    ]) {
      expect(() => assertSecureTransport(url, false)).not.toThrow();
    }
  });

  it("stops before any request to a plain-http remote studio", async () => {
    const result = await run(["projects", "list", "--url", "http://studio.example.com"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--insecure");
  });
});

describe("the access cookie", () => {
  it("goes only to the studio that issued it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "troupe-scope-"));
    folders.push(dir);
    const issuer = await startServer((_r, res) => void res.end("{}"));
    const other = await startServer((_r, res) => void res.end("{}"));
    try {
      const env = { TROUPE_CONFIG_DIR: dir, TROUPE_URL: "" };
      await writeConfig(env, { profile: "default", profiles: { default: { url: issuer.url, cookie: "abc" } } });
      await run(["whoami"], env);
      await run(["whoami", "--url", other.url], env);
      expect(issuer.requests.length).toBeGreaterThan(0);
      expect(issuer.requests.every((r) => r.headers.cookie === "troupe-access=abc")).toBe(true);
      expect(other.requests.length).toBeGreaterThan(0);
      expect(other.requests.some((r) => r.headers.cookie !== undefined)).toBe(false);
    } finally {
      await issuer.close();
      await other.close();
    }
  });

  it("is dropped when a download redirects to another origin", async () => {
    const storage = await startServer((_r, res) => void res.end("video"));
    const studio = await startServer((_r, res) => {
      res.writeHead(302, { location: `${storage.url}/file.mp4` });
      res.end();
    });
    try {
      const response = await fetchMedia({ url: studio.url, cookie: async () => "abc" }, "/api/media/x?download=1");
      expect(await response.text()).toBe("video");
      expect(studio.requests[0]!.headers.cookie).toBe("troupe-access=abc");
      expect(storage.requests[0]!.headers.cookie).toBeUndefined();
    } finally {
      await studio.close();
      await storage.close();
    }
  });
});

describe("config file", () => {
  it("is written for its owner only and read back", async () => {
    const dir = await mkdtemp(join(tmpdir(), "troupe-config-"));
    folders.push(dir);
    const env = { TROUPE_CONFIG_DIR: join(dir, "troupe") };
    expect(await readConfig(env)).toEqual({ profiles: {} });
    await writeConfig(env, { profile: "home", profiles: { home: { url: "http://127.0.0.1:3000", cookie: "c" } } });
    expect((await stat(join(dir, "troupe", "config.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, "troupe"))).mode & 0o777).toBe(0o700);
    expect(JSON.parse(await readFile(join(dir, "troupe", "config.json"), "utf8"))).toEqual({
      profile: "home",
      profiles: { home: { url: "http://127.0.0.1:3000", cookie: "c" } },
    });
  });

  it("tightens a folder that already existed with looser permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "troupe-config-"));
    folders.push(dir);
    await mkdir(join(dir, "troupe"));
    await chmod(join(dir, "troupe"), 0o755);
    await writeConfig({ TROUPE_CONFIG_DIR: join(dir, "troupe") }, { profiles: {} });
    expect((await stat(join(dir, "troupe"))).mode & 0o777).toBe(0o700);
  });

  it("loses no update when several commands change it at once", async () => {
    const dir = await mkdtemp(join(tmpdir(), "troupe-config-"));
    folders.push(dir);
    const env = { TROUPE_CONFIG_DIR: dir };
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        updateConfig(env, (config) => {
          config.profiles[`p${i}`] = { url: `http://127.0.0.1:${3000 + i}` };
        }),
      ),
    );
    expect(Object.keys((await readConfig(env)).profiles).sort()).toEqual(
      Array.from({ length: 12 }, (_, i) => `p${i}`).sort(),
    );
  });

  // A lock file whose command crashed `ageMs` ago.
  async function crashedLock(dir: string, ageMs: number) {
    const lock = join(dir, "config.json.lock");
    await writeFile(lock, "");
    const then = new Date(Date.now() - ageMs);
    await utimes(lock, then, then);
    return lock;
  }

  it("takes over a lock a crashed command left, and loses no update doing it", async () => {
    for (let round = 0; round < 5; round++) {
      const dir = await mkdtemp(join(tmpdir(), "troupe-config-"));
      folders.push(dir);
      const env = { TROUPE_CONFIG_DIR: dir };
      await crashedLock(dir, 60_000);
      await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          updateConfig(env, (config) => {
            config.profiles[`p${i}`] = { url: `http://127.0.0.1:${3000 + i}` };
          }),
        ),
      );
      expect(Object.keys((await readConfig(env)).profiles).sort(), `round ${round}`).toEqual(
        Array.from({ length: 12 }, (_, i) => `p${i}`).sort(),
      );
    }
  });

  it("waits out a lock a command crashed holding just now, instead of giving up first", async () => {
    const dir = await mkdtemp(join(tmpdir(), "troupe-config-"));
    folders.push(dir);
    await crashedLock(dir, 0);
    const started = Date.now();
    await updateConfig({ TROUPE_CONFIG_DIR: dir }, (config) => {
      config.profile = "after";
    });
    expect((await readConfig({ TROUPE_CONFIG_DIR: dir })).profile).toBe("after");
    expect(Date.now() - started).toBeGreaterThanOrEqual(LOCK_TIMING.staleMs - 100);
  });
});

describe("output and lookup", () => {
  it("aligns table columns and leaves the last one unpadded", () => {
    expect(
      table(
        ["ID", "NAME", "NOTE"],
        [
          ["1", "Maya", null],
          ["22", "Jo", "long note"],
        ],
      ),
    ).toBe("ID  NAME  NOTE\n1   Maya  -\n22  Jo    long note");
  });

  it("writes clip lengths as ranges and ends the studio's messages once", () => {
    expect(numberRanges([10, 3, 4, 5, 6, 8, 9, 15])).toBe("3-6, 8-10, 15");
    expect(numberRanges([4, 6, 8])).toBe("4, 6, 8");
    expect(numberRanges([4, 5])).toBe("4, 5");
    expect(sentence("Is it running?")).toBe("Is it running?");
    expect(sentence(" No reason ")).toBe("No reason.");
  });

  it("picks by full id, name in any case, or a unique id prefix of 4+ characters", () => {
    const items = [
      { id: "abcd1234-0000", name: "Maya" },
      { id: "abce9999-0000", name: "Jo" },
    ];
    const opts = {
      kind: "actor",
      listCommand: "troupe actors list",
      id: (i: (typeof items)[number]) => i.id,
      names: (i: (typeof items)[number]) => [i.name],
    };
    expect(pick(items, "ABCD1234-0000", opts).name).toBe("Maya");
    expect(pick(items, "maya", opts).name).toBe("Maya");
    expect(pick(items, "abce", opts).name).toBe("Jo");
    expect(() => pick(items, "abc", opts)).toThrow('No actor matches "abc". List them with troupe actors list.');
    expect(() => pick(items, "abcd", opts)).not.toThrow();
    expect(() => pick([...items, { id: "abcd5678-0000", name: "Ana" }], "abcd", opts)).toThrow(
      '"abcd" matches 2 actors',
    );
  });
});

describe("a model's state", () => {
  const model = (patch: Partial<Parameters<typeof modelState>[0]>) =>
    ({ archived: false, enabled: true, status: "ready", kind: "local", lastTest: null, ...patch }) as Parameters<
      typeof modelState
    >[0];

  it("says a local model was out of reach at its last test, as Settings does, and still lets it launch", () => {
    expect(modelState(model({}))).toBe("ready");
    expect(
      modelState(model({ lastTest: { ok: false, message: "Could not reach it.", at: "2026-10-06T18:00:00Z" } })),
    ).toBe("unreachable");
    expect(modelState(model({ lastTest: { ok: true, message: "Fine.", at: "2026-10-06T18:00:00Z" } }))).toBe("ready");
    expect(
      modelState(model({ enabled: false, lastTest: { ok: false, message: "x", at: "2026-10-06T18:00:00Z" } })),
    ).toBe("disabled");
  });
});
