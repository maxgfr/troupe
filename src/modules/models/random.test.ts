import { describe, expect, it } from "vitest";

import { randomHex } from "./random";

describe("randomHex", () => {
  it("gives two hex digits per byte, different each time", () => {
    expect(randomHex(3)).toMatch(/^[0-9a-f]{6}$/);
    expect(randomHex(6)).toMatch(/^[0-9a-f]{12}$/);
    expect(new Set(Array.from({ length: 20 }, () => randomHex(6))).size).toBe(20);
  });
});
