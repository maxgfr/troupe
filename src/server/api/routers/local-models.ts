import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure } from "~/server/api/trpc";
import { clampPollEveryS, type ConnectionReport, type ModelCapabilities } from "~/modules/generation";
import { NodeBindingSchema, parseWorkflow, workflowProblems, type ApiWorkflow } from "~/modules/generation/server/adapters/comfyui/bindings";
import { COMFY_TEMPLATES, findComfyTemplate } from "~/modules/generation/server/adapters/comfyui/templates";
import { createLocalModel, getModelConfig, listModelConfigs, LOCAL_TIMEOUT_S, newLocalModelKey, updateLocalModel } from "~/modules/models";
import { buildComfyAdapter, buildHttpAdapter, ComfyConnection, HttpConnection, MAX_WORKFLOW_BYTES, sealModelToken, type LocalDraft } from "~/server/local-models";
import { checkLocalUrl, sameOrigin, suggestedComfyUrl } from "~/server/settings/urls";
import { SecretUnavailableError } from "~/server/settings/secrets";
import { MODEL_KEY } from "./generation";

const Capabilities = z.object({
  aspectRatios: z.array(z.enum(["9:16", "16:9", "1:1"])).min(1),
  resolutions: z.array(z.enum(["480p", "540p", "576p", "720p", "1080p"])).min(1),
  durationsS: z.array(z.number().int().min(1).max(60)).min(1).max(60),
  audio: z.enum(["always", "optional", "none"]),
  dialogueLanguages: z.array(z.string().min(2).max(10)).max(20).nullable(),
});

const Label = z.string().trim().min(1).max(80);
const Token = z.string().trim().min(1).max(2000).regex(/^[^\r\n]*$/);
const Timeout = z.number().int().min(60).max(86_400);

const HttpInput = z.object({
  family: z.literal("http"),
  label: Label,
  baseUrl: z.string().max(500),
  token: Token.optional(),
  capabilities: Capabilities,
  fps: z.number().int().min(1).max(120).optional(),
  // The pace the server advertised when the form was tested.
  pollEveryS: z.number().optional(),
  timeoutS: Timeout.optional(),
});

const ComfyInput = z.object({
  family: z.literal("comfyui"),
  label: Label,
  baseUrl: z.string().max(500),
  token: Token.optional(),
  templateId: z.string().max(64).optional(),
  // Custom workflow (API format) and how Troupe drives it.
  workflow: z.unknown().optional(),
  bindings: z.array(NodeBindingSchema).max(50).default([]),
  capabilities: Capabilities.optional(),
  fps: z.number().int().min(1).max(120).optional(),
  frameRule: z.enum(["any", "4n+1", "8n+1"]).optional(),
  outputNodeId: z.string().max(32).optional(),
  negativePrompt: z.string().max(2000).optional(),
  timeoutS: Timeout.optional(),
});

const LocalInput = z.discriminatedUnion("family", [HttpInput, ComfyInput]);
type LocalInput = z.infer<typeof LocalInput>;

const bad = (message: string): never => {
  throw new TRPCError({ code: "BAD_REQUEST", message });
};

// Turn a form into what gets stored, or explain what is wrong with it.
function normalize(input: LocalInput): { capabilities: ModelCapabilities; connection: Record<string, unknown>; timeoutS: number } {
  const url = checkLocalUrl(input.baseUrl);
  if (!url.ok) return bad(url.reason);
  if (input.family === "http") {
    const connection = HttpConnection.parse({ baseUrl: url.base, fps: input.fps, pollEveryS: clampPollEveryS(input.pollEveryS) });
    return { capabilities: input.capabilities, connection, timeoutS: input.timeoutS ?? LOCAL_TIMEOUT_S };
  }
  if (input.templateId) {
    const template = findComfyTemplate(input.templateId) ?? bad(`Unknown template "${input.templateId}".`);
    return {
      capabilities: template.capabilities,
      connection: ComfyConnection.parse({ baseUrl: url.base, templateId: template.id, negativePrompt: input.negativePrompt }),
      timeoutS: input.timeoutS ?? template.timeoutS,
    };
  }
  if (input.workflow === undefined) return bad("Choose a template or import a workflow.");
  if (JSON.stringify(input.workflow).length > MAX_WORKFLOW_BYTES) return bad("The workflow is larger than 2 MB.");
  let workflow: ApiWorkflow;
  try {
    workflow = parseWorkflow(input.workflow);
  } catch (error) {
    return bad((error as Error).message);
  }
  const problems = workflowProblems(workflow, input.bindings);
  if (problems.length) return bad(problems.join(" "));
  if (!input.capabilities) return bad("Describe what the workflow can render (formats, resolutions, lengths, audio).");
  return {
    capabilities: input.capabilities,
    connection: ComfyConnection.parse({
      baseUrl: url.base, workflow, bindings: input.bindings, fps: input.fps, frameRule: input.frameRule,
      outputNodeId: input.outputNodeId, negativePrompt: input.negativePrompt,
    }),
    timeoutS: input.timeoutS ?? LOCAL_TIMEOUT_S,
  };
}

// Two models with one name look the same in every picker: refuse it.
function assertUniqueName(catalog: { models: { key: string; label: string }[] }, label: string, self?: string) {
  const wanted = label.trim().toLocaleLowerCase();
  const twin = catalog.models.find((m) => m.key !== self && m.label.trim().toLocaleLowerCase() === wanted);
  if (twin) bad(`A model is already called “${twin.label}”. Give this one another name so you can tell them apart.`);
}

function seal(modelKey: string, token: string) {
  try {
    return sealModelToken(modelKey, token);
  } catch (error) {
    if (error instanceof SecretUnavailableError) throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
    throw error;
  }
}

async function testDraft(draft: LocalDraft, family: "http" | "comfyui"): Promise<ConnectionReport> {
  const built = family === "http" ? buildHttpAdapter(draft) : buildComfyAdapter(draft);
  if (!("createJob" in built)) return { ok: false, message: built.detail };
  try {
    return await built.testConnection!();
  } catch {
    return { ok: false, message: "The model could not be reached." };
  }
}

// Procedures for adding, editing and testing local models.
export const localModelProcedures = {
  templates: protectedProcedure.query(() =>
    COMFY_TEMPLATES.map(({ id, label, description, capabilities, vramGb, verification, comfyuiVersion, requiredFiles }) => ({
      id, label, description, capabilities, vramGb, verification, comfyuiVersion,
      requiredFiles: requiredFiles.map(({ folder, filename, url }) => ({ folder, filename, url })),
    })),
  ),

  // Prefills the form's ComfyUI address for the machine Troupe runs on.
  suggestedAddress: protectedProcedure.query(({ ctx }) => ({
    comfyui: suggestedComfyUrl(ctx.machine ?? { inContainer: false, platform: "linux" }),
  })),

  createLocal: protectedProcedure.input(LocalInput).mutation(async ({ ctx, input }) => {
    assertUniqueName(ctx.catalog, input.label);
    const { capabilities, connection, timeoutS } = normalize(input);
    const id = newLocalModelKey(input.label);
    await createLocalModel(ctx.db, {
      id, family: input.family, label: input.label, capabilities, connection, timeoutS,
      secret: input.token ? seal(id, input.token) : null,
    });
    return { modelKey: id };
  }),

  // What changes on a local model in practice: its name, where it lives and
  // its token. An omitted token keeps the stored one; clearToken removes it.
  updateLocal: protectedProcedure
    .input(z.object({ modelKey: MODEL_KEY, label: Label.optional(), baseUrl: z.string().max(500).optional(), token: Token.optional(), clearToken: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const row = await getModelConfig(ctx.db, input.modelKey);
      if (!row || (row.family !== "http" && row.family !== "comfyui")) throw new TRPCError({ code: "NOT_FOUND", message: "This local model no longer exists." });
      if (input.label) assertUniqueName(ctx.catalog, input.label, input.modelKey);
      let connection: Record<string, unknown> | undefined;
      let movedOrigin = false;
      if (input.baseUrl !== undefined) {
        const url = checkLocalUrl(input.baseUrl);
        if (!url.ok) return bad(url.reason);
        const previous = (row.connection as { baseUrl?: unknown } | null)?.baseUrl;
        movedOrigin = typeof previous !== "string" || !sameOrigin(url.base, previous);
        const { pollEveryS, ...rest } = (row.connection ?? {}) as Record<string, unknown>;
        // Another server has its own pace: forget the old one until a test.
        connection = { ...rest, ...(movedOrigin ? {} : pollEveryS === undefined ? {} : { pollEveryS }), baseUrl: url.base };
      }
      await updateLocalModel(ctx.db, input.modelKey, {
        ...(input.label ? { label: input.label } : {}),
        ...(connection ? { connection } : {}),
        // A token is only ever sent to the server it was given for: moving the
        // model to another origin drops it unless a new one comes along.
        ...(input.token ? { secret: seal(input.modelKey, input.token) } : input.clearToken || movedOrigin ? { secret: null } : {}),
      });
    }),

  // Where each local model lives, for the edit form. Never the token.
  connections: protectedProcedure.query(async ({ ctx }) =>
    (await listModelConfigs(ctx.db))
      .filter((r) => r.family === "http" || r.family === "comfyui")
      .map((r) => {
        const c = (r.connection ?? {}) as { baseUrl?: unknown; templateId?: unknown };
        return { modelKey: r.id, baseUrl: typeof c.baseUrl === "string" ? c.baseUrl : "", templateId: typeof c.templateId === "string" ? c.templateId : null, hasToken: Boolean(r.secretCiphertext) };
      }),
  ),

  // Test a form before saving it. Nothing is stored.
  testDraft: protectedProcedure.input(LocalInput).mutation(({ input }) => {
    const { capabilities, connection } = normalize(input);
    return testDraft({ modelKey: "draft", label: input.label, capabilities, connection, token: input.token }, input.family);
  }),
};
