import { describe, expect, it } from "vitest";

import { dedupeRunsById } from "./dedupe-runs";

// A react-query refetch of the first page can slide a run that
// already sits in an appended older page — concat without dedup would render it
// twice. Dedup by id keeps the first (newest, authoritative) occurrence.
describe("dedupeRunsById", () => {
  it("drops a later duplicate id, keeping the first occurrence in order", () => {
    const first = { id: "a", brief: "fresh" };
    const b = { id: "b", brief: "b" };
    const dupOfA = { id: "a", brief: "stale copy" };
    expect(dedupeRunsById([first, b, dupOfA])).toEqual([first, b]);
  });

  it("is a no-op when every id is unique", () => {
    const runs = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(dedupeRunsById(runs)).toEqual(runs);
  });
});
