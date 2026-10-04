import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";

import { serverGuard } from "./vite-plugins";

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
