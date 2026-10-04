import { describe, expect, it } from "vitest";

import { disclosureFor } from "~/modules/export";

// AI disclosure is platform law, not boilerplate —
// TikTok strikes undisclosed realistic AI content, Meta labels it, the FTC
// fines up to $51,744 per violation. One matrix, verified at export time.
describe("per-platform AI disclosure matrix", () => {
  it("TikTok demands the AI-content toggle", () => {
    const d = disclosureFor("tiktok");
    expect(d.requirement).toBe("toggle");
    expect(d.detail).toMatch(/toggle/i);
  });

  it("Instagram (Meta) relies on the platform label", () => {
    expect(disclosureFor("instagram").requirement).toBe("platform-label");
  });

  it("YouTube requires the altered-content disclosure", () => {
    expect(disclosureFor("youtube").requirement).toBe("upload-disclosure");
  });

  it("LinkedIn ships the disclosure in the caption", () => {
    const d = disclosureFor("linkedin");
    expect(d.requirement).toBe("caption");
    expect(d.detail).toMatch(/caption/i);
  });
});
