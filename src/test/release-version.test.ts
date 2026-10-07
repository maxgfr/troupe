import { describe, expect, it } from "vitest";

import { releaseVersion } from "../../scripts/release-version.mjs";

describe("releaseVersion", () => {
  it("takes the version a release build was given, with or without its tag's v", () => {
    expect(releaseVersion("0.3.0", "0.2.0")).toBe("0.3.0");
    expect(releaseVersion(" v1.0.0 ", "0.2.0")).toBe("1.0.0");
    expect(releaseVersion("1.0.0-beta.2+build.5", "0.2.0")).toBe("1.0.0-beta.2+build.5");
  });

  it("falls back to package.json's for anything that is not a version", () => {
    for (const candidate of [undefined, "", "latest", "main", "1.2", "v", "1.2.3.4"]) {
      expect(releaseVersion(candidate, "0.2.0"), String(candidate)).toBe("0.2.0");
    }
  });
});
