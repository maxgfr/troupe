import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The troupe-cli image builds the CLI from a context of its own
// (cli/Dockerfile.dockerignore, cli/Dockerfile): every studio file the CLI
// imports must be let into that context and copied, or the image's build
// cannot resolve it while every other build can.
const root = resolve(import.meta.dirname, "../..");

async function sources(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts"))
    .map((e) => join(e.parentPath, e.name));
}

describe("the troupe-cli image", () => {
  it("lets in and copies every studio file the CLI imports", async () => {
    const shared = new Set<string>();
    for (const file of await sources(join(root, "cli/src"))) {
      // `import type` is erased from the bundle: only values need the file.
      for (const [, typeOnly, spec] of (await readFile(file, "utf8")).matchAll(
        /^import(\s+type)?\b[^;]*?from "(\.\.\/[^"]+)"/gm,
      )) {
        if (typeOnly) continue;
        const target = relative(root, resolve(file, "..", spec!));
        if (!target.startsWith("cli/")) shared.add(target);
      }
    }
    expect(shared.size).toBeGreaterThan(0);
    const ignore = await readFile(join(root, "cli/Dockerfile.dockerignore"), "utf8");
    const dockerfile = await readFile(join(root, "cli/Dockerfile"), "utf8");
    for (const target of shared) {
      expect(ignore, `cli/Dockerfile.dockerignore lets in ${target}`).toContain(`!${target}\n`);
      expect(dockerfile, `cli/Dockerfile copies ${target}`).toContain(target);
    }
  });
});
