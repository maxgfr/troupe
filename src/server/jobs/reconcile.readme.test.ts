import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

// Job checks must stay documented for both ways of hosting: Docker runs them
// in the app, serverless hosting needs a scheduler hitting the trigger.
describe("job check documentation", () => {
  it("explains the built-in Docker checks", () => {
    expect(doc("docs/SELF-HOSTING.md")).toContain("checks running renders every 30 seconds");
  });

  it("gives serverless hosts a paste-ready trigger", () => {
    const guide = doc("docs/VERCEL-SUPABASE.md");
    expect(guide).toContain("x-reconcile-secret");
    expect(guide).toContain("/api/jobs/reconcile");
  });

  it("documents every HTTP contract field the adapter sends", () => {
    const guide = doc("docs/LOCAL-MODELS.md");
    for (const field of [
      "aspect_ratio",
      "resolution",
      "width",
      "height",
      "duration_s",
      "fps",
      "audio",
      "video_url",
      "contract",
    ])
      expect(guide).toContain(field);
  });
});
