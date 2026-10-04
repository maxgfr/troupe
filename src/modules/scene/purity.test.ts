import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The scene runs in the browser and in the Node renderer: its code must not
// reach for Node, the DOM or another module's runtime code.
const dir = import.meta.dirname;
const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

describe("scene module purity", () => {
  it.each(sources)("%s imports only its own files, and other modules' types", (file) => {
    const code = readFileSync(join(dir, file), "utf8");
    const imports = [...code.matchAll(/^(import|export)\s+(type\s+)?[^;]*?from\s+"([^"]+)"/gm)];
    for (const [statement, , typeOnly, source] of imports) {
      if (source!.startsWith("./")) continue;
      expect(typeOnly, `${file}: ${statement}`).toBeDefined();
    }
    expect(code).not.toMatch(/\b(document|window|process|Buffer|OffscreenCanvas|require)\b/);
  });
});
