import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Design foundation: the CSS custom properties must carry exactly the design
// tokens in src/styles/design-tokens.json.
describe("design tokens", () => {
  const dir = join(process.cwd(), "src/styles");
  const tokens = JSON.parse(readFileSync(join(dir, "design-tokens.json"), "utf8")) as Record<string, Record<string, string>>;
  const css = readFileSync(join(dir, "design-tokens.css"), "utf8");

  it("exposes every color, spacing and radius token as a CSS variable with the spec value", () => {
    for (const category of ["color", "spacing", "radius"]) {
      for (const [name, value] of Object.entries(tokens[category]!)) {
        if (name === "unit") continue;
        expect(css, `${category}.${name}`).toContain(`--troupe-${category}-${name}: ${value}`);
      }
    }
  });

  it("keeps the brand cobalt primary and danger colors (« régie avant le direct »)", () => {
    expect(tokens.color!.primary).toBe("oklch(0.7 0.14 250)");
    expect(tokens.color!.danger).toBe("oklch(0.62 0.21 15)");
  });

  it("exposes the light-theme variant for every color token", () => {
    for (const name of Object.keys(tokens.color!)) {
      expect(tokens["color-light"]![name], `color-light.${name}`).toBeTruthy();
    }
  });
});
