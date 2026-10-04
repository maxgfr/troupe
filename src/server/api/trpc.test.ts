import { describe, expect, it } from "vitest";

import { timingLine } from "~/server/api/trpc";

// The timing middleware is a dev aid — production hot
// paths must not console.log every procedure call.
describe("tRPC timing middleware logging", () => {
  it("emits a timing line in development", () => {
    expect(timingLine("studio.getProject", 42, true)).toBe("[TRPC] studio.getProject took 42ms to execute");
  });

  it("stays silent outside development", () => {
    expect(timingLine("studio.getProject", 42, false)).toBeNull();
  });
});
