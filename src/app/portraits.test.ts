import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// F5 (eval 2026-07-12): actor portraits must never load from an external
// placeholder service — no third-party host in product code (NFR: souveraineté
// du rendu, pas de fuite d'ids acteurs).
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "node_modules" ? [] : walk(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("actor portraits are self-hosted", () => {
  it("no source file references pravatar.cc or another external avatar host", () => {
    const offenders = walk(join(process.cwd(), "src")).filter((p) => {
      const body = readFileSync(p, "utf8");
      return /pravatar\.cc|ui-avatars\.com|i\.imgur\.com/.test(body) && !p.endsWith("portraits.test.ts");
    });
    expect(offenders).toEqual([]);
  });
});
