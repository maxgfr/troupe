import { describe, expect, it } from "vitest";

import { bindWorkflow, parseWorkflow, workflowProblems } from "./bindings";

const workflow = {
  "6": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}", clip: ["38", 0] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "blurry, {{negative_prompt}}", clip: ["38", 0] } },
  "55": { class_type: "Wan22ImageToVideoLatent", inputs: { width: "{{width}}", height: "{{height}}", length: "{{frames}}", batch_size: 1 } },
  "3": { class_type: "KSampler", inputs: { seed: 0, steps: 20 } },
  "58": { class_type: "SaveVideo", inputs: { filename_prefix: "video/ComfyUI", format: "mp4" } },
};
const values = { prompt: "Hello", negative_prompt: "text", width: 704, height: 1280, frames: 121, fps: 24, duration_s: 5, seed: 42, audio: false, filename_prefix: "troupe/abc" };

describe("ComfyUI workflow bindings", () => {
  it("replaces whole placeholders with typed values and embedded ones as text", () => {
    const bound = bindWorkflow(workflow, [], values);
    expect(bound["6"]!.inputs.text).toBe("Hello");
    expect(bound["7"]!.inputs.text).toBe("blurry, text");
    expect(bound["55"]!.inputs).toMatchObject({ width: 704, height: 1280, length: 121, batch_size: 1 });
    expect(workflow["55"].inputs.width).toBe("{{width}}");
  });

  it("applies node bindings for workflows without placeholders", () => {
    const bound = bindWorkflow(workflow, [{ param: "seed", nodeId: "3", input: "seed" }, { param: "filename_prefix", nodeId: "58", input: "filename_prefix" }], values);
    expect(bound["3"]!.inputs.seed).toBe(42);
    expect(bound["58"]!.inputs.filename_prefix).toBe("troupe/abc");
  });

  it("explains UI-format exports and broken bindings", () => {
    expect(() => parseWorkflow({ nodes: [], links: [] })).toThrow(/Export \(API\)/);
    expect(() => parseWorkflow("nope")).toThrow(/JSON object/);
    expect(workflowProblems(parseWorkflow(workflow), [{ param: "seed", nodeId: "99", input: "seed" }])).toEqual(["Binding for seed points to node 99, which is not in the workflow."]);
    const noPrompt = { "3": workflow["3"] };
    expect(workflowProblems(parseWorkflow(noPrompt), [])).toContain("Nothing receives the prompt: put {{prompt}} in a text input or bind it to a node.");
  });
});
