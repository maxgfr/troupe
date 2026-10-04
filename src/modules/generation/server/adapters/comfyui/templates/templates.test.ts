import { describe, expect, it } from "vitest";

import { framesFor, sizeFor } from "~/modules/models/geometry";
import { parseWorkflow, placeholdersIn, workflowProblems } from "../bindings";
import { COMFY_TEMPLATES } from "./index";

describe.each(COMFY_TEMPLATES.map((t) => [t.id, t] as const))("bundled ComfyUI template %s", (_id, template) => {
  const workflow = parseWorkflow(template.workflow);

  it("is a valid API workflow whose placeholders Troupe fills", () => {
    expect(workflowProblems(workflow, template.bindings)).toEqual([]);
    for (const p of ["prompt", "width", "height", "frames", "seed", "filename_prefix"]) expect(placeholdersIn(workflow)).toContain(p);
  });

  it("saves an H.264 MP4 from the declared output node", () => {
    const save = workflow[template.outputNodeId!]!;
    expect(save.class_type).toBe("SaveVideo");
    expect(save.inputs).toMatchObject({ format: "mp4", codec: "h264" });
  });

  it("has an exact size for every format and resolution it offers", () => {
    for (const ar of template.capabilities.aspectRatios) {
      for (const res of template.capabilities.resolutions) {
        expect(template.sizeTable?.[`${ar}@${res}`], `${ar}@${res}`).toBeDefined();
        const { width, height } = sizeFor(ar, res, { table: template.sizeTable });
        expect(width % 32).toBe(0);
        expect(height % 32).toBe(0);
      }
    }
    for (const d of template.capabilities.durationsS) expect(framesFor(d, template.fps, template.frameRule)).toBeGreaterThan(d * template.fps * 0.9);
  });

  it("lists loaders that are really in the workflow for each model file", () => {
    const classes = new Set(Object.values(workflow).map((n) => n.class_type));
    for (const file of template.requiredFiles) expect(classes.has(file.nodeClass), file.nodeClass).toBe(true);
    expect(template.timeoutS).toBe(7200);
  });
});
