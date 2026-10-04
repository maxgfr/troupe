import { z } from "zod";

// A ComfyUI workflow in API format ("Export (API)"): node id → node.
export type ApiWorkflow = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }>;

export const COMFY_PARAMS = ["prompt", "negative_prompt", "width", "height", "frames", "fps", "duration_s", "seed", "audio", "filename_prefix"] as const;
export type ComfyParam = (typeof COMFY_PARAMS)[number];
export type ComfyValues = Record<ComfyParam, string | number | boolean>;

// Either put {{param}} in a node input, or point a param at a node input.
export interface NodeBinding {
  param: ComfyParam;
  nodeId: string;
  input: string;
}

export const NodeBindingSchema = z.object({ param: z.enum(COMFY_PARAMS), nodeId: z.string().min(1).max(32), input: z.string().min(1).max(100) });

const ApiNode = z.object({ class_type: z.string().min(1), inputs: z.record(z.unknown()), _meta: z.object({ title: z.string().optional() }).passthrough().optional() }).passthrough();

export function parseWorkflow(json: unknown): ApiWorkflow {
  if (typeof json !== "object" || json === null || Array.isArray(json)) throw new Error("The workflow must be a JSON object.");
  if ("nodes" in json && "links" in json) {
    throw new Error("This is a UI workflow. In ComfyUI, use Workflow → Export (API) and import that file instead.");
  }
  const parsed = z.record(ApiNode).safeParse(json);
  if (!parsed.success || Object.keys(parsed.data).length === 0) throw new Error("This file is not a ComfyUI API workflow (expected node ids mapped to { class_type, inputs }).");
  return parsed.data as ApiWorkflow;
}

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;

export function placeholdersIn(workflow: ApiWorkflow): Set<string> {
  const found = new Set<string>();
  for (const node of Object.values(workflow)) {
    for (const value of Object.values(node.inputs)) {
      if (typeof value === "string") for (const m of value.matchAll(PLACEHOLDER)) found.add(m[1]!);
    }
  }
  return found;
}

export function workflowProblems(workflow: ApiWorkflow, bindings: NodeBinding[]): string[] {
  const problems: string[] = [];
  for (const b of bindings) {
    const node = workflow[b.nodeId];
    if (!node) problems.push(`Binding for ${b.param} points to node ${b.nodeId}, which is not in the workflow.`);
    else if (!(b.input in node.inputs)) problems.push(`Node ${b.nodeId} (${node.class_type}) has no input "${b.input}" for ${b.param}.`);
  }
  const placeholders = placeholdersIn(workflow);
  for (const p of placeholders) if (!(COMFY_PARAMS as readonly string[]).includes(p)) problems.push(`Unknown placeholder {{${p}}}. Known: ${COMFY_PARAMS.join(", ")}.`);
  if (!placeholders.has("prompt") && !bindings.some((b) => b.param === "prompt")) {
    problems.push("Nothing receives the prompt: put {{prompt}} in a text input or bind it to a node.");
  }
  return problems;
}

// Fill a copy of the workflow. A value that is exactly "{{param}}" takes the
// typed value (numbers stay numbers); a placeholder inside text is replaced
// as text. Node bindings then overwrite their targets.
export function bindWorkflow(workflow: ApiWorkflow, bindings: NodeBinding[], values: ComfyValues): ApiWorkflow {
  const out = structuredClone(workflow);
  for (const node of Object.values(out)) {
    for (const [key, value] of Object.entries(node.inputs)) {
      if (typeof value !== "string" || !value.includes("{{")) continue;
      const whole = /^\{\{\s*([a-z_]+)\s*\}\}$/.exec(value);
      if (whole && whole[1]! in values) {
        node.inputs[key] = values[whole[1] as ComfyParam];
        continue;
      }
      node.inputs[key] = value.replace(PLACEHOLDER, (m, name: string) => (name in values ? String(values[name as ComfyParam]) : m));
    }
  }
  for (const b of bindings) {
    const node = out[b.nodeId];
    if (node) node.inputs[b.input] = values[b.param];
  }
  return out;
}
