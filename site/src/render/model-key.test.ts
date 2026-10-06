import { describe, expect, it } from "vitest";

import { BROWSER_MODEL_KEY as STUDIO_KEY } from "~/modules/generation";
import { BROWSER_MODEL_KEY } from "./model-key";

describe("the browser edition's model key", () => {
  it("is the studio's", () => {
    expect(BROWSER_MODEL_KEY).toBe(STUDIO_KEY);
  });
});
