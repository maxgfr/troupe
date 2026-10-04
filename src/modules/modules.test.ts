import { describe, expect, it } from "vitest";

// One folder per domain module, each behind a barrel.
const MODULES = ["identity", "actors", "script", "generation", "models", "benchmark", "studio", "export", "scene", "chat"] as const;

describe("module skeleton", () => {
  it("exposes every module behind an importable barrel", async () => {
    for (const m of MODULES) {
      const barrel: unknown = await import(`./${m}/index.ts`);
      expect(barrel, m).toBeTypeOf("object");
    }
  });
});
