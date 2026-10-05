import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The scene runs in the browser and in the Node renderer: its code must not
// reach for Node, the DOM or another module's runtime code.
const dir = import.meta.dirname;
const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

// Every import that loads code from outside the module: `import … from`,
// `export … from`, a side-effect `import "…"` and a dynamic `import("…")`.
// Type-only imports and the module's own files are fine.
function foreignImports(code: string): string[] {
  const found: string[] = [];
  for (const [statement, typeOnly, source] of code.matchAll(/^\s*(?:import|export)\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/gm)) {
    if (!typeOnly && !source!.startsWith("./")) found.push(statement.trim());
  }
  for (const [statement, source] of code.matchAll(/^\s*import\s*["']([^"']+)["']/gm)) {
    if (!source!.startsWith("./")) found.push(statement.trim());
  }
  for (const [statement] of code.matchAll(/\bimport\s*\(/g)) found.push(statement);
  return found;
}

describe("scene module purity", () => {
  it("catches every way of loading another module's code", () => {
    expect(foreignImports('import type { Emotion } from "~/modules/script";\nimport { cueAt } from "./build";')).toEqual([]);
    expect(foreignImports('import { db } from "~/server/db";')).toHaveLength(1);
    expect(foreignImports('export { a } from "node:fs";')).toHaveLength(1);
    expect(foreignImports('import "~/server/polyfill";')).toHaveLength(1);
    expect(foreignImports("import './side-effect';")).toEqual([]);
    expect(foreignImports('const fs = await import("node:fs");')).toHaveLength(1);
    expect(foreignImports('const x = await import ("./build");')).toHaveLength(1);
  });

  it.each(sources)("%s imports only its own files, and other modules' types", (file) => {
    const code = readFileSync(join(dir, file), "utf8");
    expect(foreignImports(code), file).toEqual([]);
    expect(code).not.toMatch(/\b(document|window|process|Buffer|OffscreenCanvas|require)\b/);
  });
});
