import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { mainHelp, runCli } from "./cli.ts";
import type { Io } from "./command.ts";
import { readConfig, writeConfig } from "./config.ts";
import { numberRanges, sentence, table } from "./output.ts";
import { pick } from "./resolve.ts";

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
    sleep: async () => undefined,
  };
  const code = await runCli(args, io);
  return { code, stdout: out.join(""), stderr: err.join("") };
}

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
    expect((await run(["--version"])).stdout).toBe("0.1.0\n");
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
    expect(JSON.parse(result.stderr)).toEqual({ error: { code: "UNREACHABLE", exitCode: 4, message: expect.stringContaining(`Cannot reach the studio at http://127.0.0.1:${closedPort} (ECONNREFUSED)`) } });
  });

  it("checks option values before calling the studio", async () => {
    expect((await run(["render", "watch", "--interval", "0"], { TROUPE_PROJECT: "11111111-1111-4111-8111-111111111111" })).code).toBe(4);
    const bad = await run(["models", "add", "http", "--name", "Box", "--base-url", "http://10.0.0.5:8000", "--durations", "4,x"]);
    expect(bad).toMatchObject({ code: 2, stderr: 'troupe: --durations takes whole seconds between 1 and 60, not "x".\n' });
    expect((await run(["models", "add", "http", "--name", "Box", "--base-url", "http://10.0.0.5:8000", "--audio", "loud"])).stderr).toContain("--audio takes one of always, optional, none");
    expect((await run(["projects", "list", "--url", "ftp://x"])).stderr).toContain("Use an http:// or https:// address");
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
    expect(JSON.parse(await readFile(join(dir, "troupe", "config.json"), "utf8"))).toEqual({ profile: "home", profiles: { home: { url: "http://127.0.0.1:3000", cookie: "c" } } });
  });
});

describe("output and lookup", () => {
  it("aligns table columns and leaves the last one unpadded", () => {
    expect(table(["ID", "NAME", "NOTE"], [["1", "Maya", null], ["22", "Jo", "long note"]])).toBe("ID  NAME  NOTE\n1   Maya  -\n22  Jo    long note");
  });

  it("writes clip lengths as ranges and ends the studio's messages once", () => {
    expect(numberRanges([10, 3, 4, 5, 6, 8, 9, 15])).toBe("3-6, 8-10, 15");
    expect(numberRanges([4, 6, 8])).toBe("4, 6, 8");
    expect(numberRanges([4, 5])).toBe("4, 5");
    expect(sentence("Is it running?")).toBe("Is it running?");
    expect(sentence(" No reason ")).toBe("No reason.");
  });

  it("picks by full id, name in any case, or a unique id prefix of 4+ characters", () => {
    const items = [{ id: "abcd1234-0000", name: "Maya" }, { id: "abce9999-0000", name: "Jo" }];
    const opts = { kind: "actor", listCommand: "troupe actors list", id: (i: (typeof items)[number]) => i.id, names: (i: (typeof items)[number]) => [i.name] };
    expect(pick(items, "ABCD1234-0000", opts).name).toBe("Maya");
    expect(pick(items, "maya", opts).name).toBe("Maya");
    expect(pick(items, "abce", opts).name).toBe("Jo");
    expect(() => pick(items, "abc", opts)).toThrow('No actor matches "abc". List them with troupe actors list.');
    expect(() => pick(items, "abcd", opts)).not.toThrow();
    expect(() => pick([...items, { id: "abcd5678-0000", name: "Ana" }], "abcd", opts)).toThrow('"abcd" matches 2 actors');
  });
});
