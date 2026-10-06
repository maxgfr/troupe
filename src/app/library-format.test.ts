import { describe, expect, it } from "vitest";

import { shortfall } from "./(app)/library/format";

describe("a set of ideas cut short", () => {
  it("says how many were written of how many asked for", () => {
    expect(shortfall(3, 3, "ideas")).toBeNull();
    expect(shortfall(10, 4, "ideas")).toBe(
      "Wrote 4 of 10 ideas: the model's answer was cut short. Ask again for more.",
    );
    expect(shortfall(5, 1, "remix")).toBe("Wrote 1 of 5 hooks: the model's answer was cut short. Ask again for more.");
    expect(shortfall(3, 2, "repurpose")).toBe(
      "Wrote 2 of 3 scripts: the model's answer was cut short. Ask again for more.",
    );
  });
});
