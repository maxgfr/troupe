// @vitest-environment jsdom
// export/page.tsx splits into named panels
// — same recipe as the wizard/script cuts. The page composes; panels own JSX.
import { describe, expect, it } from "vitest";

import * as sections from "./export-sections";

describe("export panels", () => {
  it("each export panel is a named component", () => {
    expect(typeof sections.RenderPicker).toBe("function");
    expect(typeof sections.PlatformPreset).toBe("function");
    expect(typeof sections.CaptionFields).toBe("function");
    expect(typeof sections.DisclosurePanel).toBe("function");
  });
});
