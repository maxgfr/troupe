import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";

import { actorPictures, actorPicturesMiddleware, serverGuard } from "./vite-plugins";

// A throwaway project: an entry that imports one fake dependency.
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(dependency: string, source: string) {
  const dir = mkdtempSync(join(tmpdir(), "troupe-guard-"));
  dirs.push(dir);
  const pkg = join(dir, "node_modules", dependency);
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: dependency, type: "module", main: "index.js" }));
  writeFileSync(join(pkg, "index.js"), source);
  writeFileSync(join(dir, "index.js"), `import value from "${dependency}";\nconsole.log(value);\n`);
  return dir;
}

function bundle(root: string, guard = serverGuard()) {
  return build({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [guard],
    build: { write: false, rollupOptions: { input: join(root, "index.js") } },
  });
}

describe("server guard", () => {
  it("fails the build when a dependency imports a node: module", async () => {
    const root = project("leaky", `import { readFileSync } from "node:fs";\nexport default readFileSync;\n`);
    await expect(bundle(root)).rejects.toThrow(/node:fs is a Node built-in \(imported by leaky\)/);
  });

  it("fails the build on a bare built-in such as fs, too", async () => {
    const root = project("leaky-bare", `import fs from "fs";\nexport default fs;\n`);
    await expect(bundle(root)).rejects.toThrow(/fs is a Node built-in \(imported by leaky-bare\)/);
  });

  it("lets a dependency use the built-ins it is allowed, and only those", async () => {
    const root = project("guarded", `import fs from "fs";\nexport default fs;\n`);
    await expect(bundle(root, serverGuard({ nodeBuiltinsAllowedIn: { guarded: { builtins: ["fs"], reason: "test" } } }))).resolves.toBeTruthy();

    const other = project("guarded", `import zlib from "zlib";\nexport default zlib;\n`);
    await expect(bundle(other, serverGuard({ nodeBuiltinsAllowedIn: { guarded: { builtins: ["fs"], reason: "test" } } }))).rejects.toThrow(/zlib is a Node built-in/);
  });
});

describe("actor pictures", () => {
  function cast() {
    const dir = mkdtempSync(join(tmpdir(), "troupe-cast-"));
    dirs.push(dir);
    mkdirSync(join(dir, "cast", "lea-01", "v1"), { recursive: true });
    writeFileSync(join(dir, "cast", "lea-01", "v1", "front.webp"), "RIFF-front");
    writeFileSync(join(dir, "cast", "lea-01", "v1", "notes.txt"), "not for the site");
    writeFileSync(join(dir, "index.js"), "console.log(1);\n");
    return dir;
  }

  it("copies the pictures, and only them, into the build at <base>actors/", async () => {
    const root = cast();
    const outDir = join(root, "dist");
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [actorPictures({ base: "/troupe/", dir: join(root, "cast"), outDir })],
      build: { outDir, rollupOptions: { input: join(root, "index.js") } },
    });
    expect(readFileSync(join(outDir, "actors", "lea-01", "v1", "front.webp"), "utf8")).toBe("RIFF-front");
    expect(existsSync(join(outDir, "actors", "lea-01", "v1", "notes.txt"))).toBe(false);
  });

  it("stops the build when the pictures folder is missing", async () => {
    const root = cast();
    const outDir = join(root, "dist");
    await expect(
      build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [actorPictures({ base: "/troupe/", dir: join(root, "nowhere"), outDir })],
        build: { outDir, rollupOptions: { input: join(root, "index.js") } },
      }),
    ).rejects.toThrow(/pictures folder .*nowhere does not exist/);
  });
});

describe("actor pictures in vite dev", () => {
  function serve(url: string) {
    const root = mkdtempSync(join(tmpdir(), "troupe-cast-dev-"));
    dirs.push(root);
    mkdirSync(join(root, "lea-01", "v1"), { recursive: true });
    writeFileSync(join(root, "lea-01", "v1", "front.webp"), "RIFF-front");
    writeFileSync(join(root, "secret.txt"), "no");
    const sent: { type?: string; body?: string; next: boolean } = { next: false };
    const res = { setHeader: (_: string, v: string) => (sent.type = v), end: (b: Buffer) => (sent.body = b.toString()) };
    actorPicturesMiddleware("/troupe/", root)({ url } as never, res as never, () => (sent.next = true));
    return sent;
  }

  it("serves a picture with its type", () => {
    expect(serve("/troupe/actors/lea-01/v1/front.webp?x=1")).toEqual({ type: "image/webp", body: "RIFF-front", next: false });
  });

  it("passes anything else on: other paths, other files, escapes and malformed URLs", () => {
    for (const url of ["/troupe/app/", "/troupe/actors/secret.txt", "/troupe/actors/..%2F..%2Fetc%2Fpasswd.webp", "/troupe/actors/%E0%A4%A.webp"]) {
      expect(serve(url), url).toEqual({ next: true });
    }
  });
});
