// The vote winner must be a STRICT max — two entries at the same
// top score is a tie, and a tie must never silently crown the first insertion.
import { describe, expect, it } from "vitest";

import { tallyWinner } from "./winner";

const entry = (id: string, votes: Record<string, number>) => ({ id, modelKey: id, votes });

describe("tallyWinner", () => {
  it("picks the entry with the highest vote total", () => {
    const res = tallyWinner([entry("veo", { u1: 1 }), entry("kling", { u1: 1, u2: 1 })]);
    expect(res).toEqual({ winnerId: "kling", tie: false });
  });

  it("declares a tie when two entries share the top score", () => {
    const res = tallyWinner([entry("veo", { u1: 1 }), entry("kling", { u2: 1 })]);
    expect(res).toEqual({ winnerId: null, tie: true });
  });

  it("has no winner and no tie when nobody voted", () => {
    const res = tallyWinner([entry("veo", {}), entry("kling", {})]);
    expect(res).toEqual({ winnerId: null, tie: false });
  });

  it("a three-way tie is still a tie", () => {
    const res = tallyWinner([entry("a", { u: 2 }), entry("b", { v: 2 }), entry("c", { w: 2 })]);
    expect(res).toEqual({ winnerId: null, tie: true });
  });

  it("missing votes objects count as zero", () => {
    const res = tallyWinner([{ id: "a", modelKey: "a" }, entry("b", { u: 1 })]);
    expect(res).toEqual({ winnerId: "b", tie: false });
  });
});
