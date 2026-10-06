import { z } from "zod";

import { createComfyAdapter, type ComfyModel } from "~/modules/generation/server/adapters/comfyui/adapter";
import {
  NodeBindingSchema,
  parseWorkflow,
  workflowProblems,
  type ApiWorkflow,
} from "~/modules/generation/server/adapters/comfyui/bindings";
import { findComfyTemplate } from "~/modules/generation/server/adapters/comfyui/templates";
import { createHttpEndpointAdapter } from "~/modules/generation/server/adapters/http-endpoint";
import type { ModelCapabilities, VideoProviderAdapter } from "~/modules/generation";
import type { ModelConfigRow, ModelStatus } from "~/modules/models";
import { checkLocalUrl } from "~/server/settings/urls";
import { loadSecretBox, SecretUnavailableError } from "~/server/settings/secrets";

// Local model connections, as stored in model_config.connection. Nothing in
// here is secret; the token lives sealed in secretCiphertext.

export const MAX_WORKFLOW_BYTES = 2 * 1024 * 1024;

export const HttpConnection = z.object({
  baseUrl: z.string().min(1).max(500),
  fps: z.number().int().min(1).max(120).optional(),
  sizeMultiple: z.number().int().min(1).max(128).optional(),
  maxDownloadMb: z.number().int().min(1).max(4096).optional(),
  // Learned from the server's /health (poll_every_s); clamped when used.
  pollEveryS: z.number().optional(),
});

export const ComfyConnection = z.object({
  baseUrl: z.string().min(1).max(500),
  // A bundled template, or a custom workflow with its own settings.
  templateId: z.string().max(64).optional(),
  workflow: z.unknown().optional(),
  bindings: z.array(NodeBindingSchema).max(50).default([]),
  fps: z.number().int().min(1).max(120).optional(),
  frameRule: z.enum(["any", "4n+1", "8n+1"]).optional(),
  sizeMultiple: z.number().int().min(1).max(128).optional(),
  outputNodeId: z.string().max(32).optional(),
  negativePrompt: z.string().max(2000).optional(),
});

export type Veto = { status: ModelStatus; detail: string };

export const secretAad = (modelKey: string) => `model_config:${modelKey}`;

export function sealModelToken(modelKey: string, token: string) {
  const box = loadSecretBox();
  return { ciphertext: box.seal(token, secretAad(modelKey)), fingerprint: box.fingerprint };
}

function openToken(
  row: Pick<ModelConfigRow, "id" | "secretCiphertext" | "secretFingerprint">,
): string | undefined | Veto {
  if (!row.secretCiphertext) return undefined;
  try {
    const box = loadSecretBox();
    if (row.secretFingerprint !== box.fingerprint) throw new SecretUnavailableError();
    return box.open(row.secretCiphertext, secretAad(row.id));
  } catch {
    return { status: "undecryptable", detail: "The saved token can no longer be read. Enter it again." };
  }
}

const isVeto = (v: unknown): v is Veto => typeof v === "object" && v !== null && "status" in v;

export interface LocalDraft {
  modelKey: string;
  label: string;
  capabilities: ModelCapabilities;
  connection: unknown;
  token?: string;
}

export function buildHttpAdapter(draft: LocalDraft): VideoProviderAdapter | Veto {
  const connection = HttpConnection.safeParse(draft.connection);
  if (!connection.success)
    return { status: "invalid", detail: "The endpoint settings are incomplete. Edit the model." };
  const url = checkLocalUrl(connection.data.baseUrl);
  if (!url.ok) return { status: "unsupported-host", detail: url.reason };
  return createHttpEndpointAdapter({
    model: {
      modelKey: draft.modelKey,
      label: draft.label,
      baseUrl: url.base,
      token: draft.token,
      capabilities: draft.capabilities,
      fps: connection.data.fps,
      sizeMultiple: connection.data.sizeMultiple,
      pollEveryS: connection.data.pollEveryS,
      maxDownloadBytes: connection.data.maxDownloadMb ? connection.data.maxDownloadMb * 1024 * 1024 : undefined,
    },
  });
}

export function comfyModelFrom(draft: LocalDraft): ComfyModel | Veto {
  const connection = ComfyConnection.safeParse(draft.connection);
  if (!connection.success) return { status: "invalid", detail: "The ComfyUI settings are incomplete. Edit the model." };
  const url = checkLocalUrl(connection.data.baseUrl);
  if (!url.ok) return { status: "unsupported-host", detail: url.reason };
  const c = connection.data;
  const common = {
    modelKey: draft.modelKey,
    label: draft.label,
    baseUrl: url.base,
    token: draft.token,
    capabilities: draft.capabilities,
  };
  if (c.templateId) {
    const template = findComfyTemplate(c.templateId);
    if (!template)
      return {
        status: "invalid",
        detail: `The template "${c.templateId}" is not bundled with this version of Troupe.`,
      };
    return {
      ...common,
      workflow: template.workflow,
      bindings: template.bindings,
      fps: template.fps,
      frameRule: template.frameRule,
      sizeTable: template.sizeTable,
      sizeMultiple: template.sizeMultiple,
      negativePrompt: c.negativePrompt ?? template.negativePrompt,
      outputNodeId: template.outputNodeId,
      requiredFiles: template.requiredFiles,
      vramGb: template.vramGb,
    };
  }
  let workflow: ApiWorkflow;
  try {
    workflow = parseWorkflow(c.workflow);
  } catch (error) {
    return { status: "invalid", detail: (error as Error).message };
  }
  const problems = workflowProblems(workflow, c.bindings);
  if (problems.length) return { status: "invalid", detail: problems[0]! };
  return {
    ...common,
    workflow,
    bindings: c.bindings,
    fps: c.fps ?? 24,
    frameRule: c.frameRule ?? "any",
    sizeMultiple: c.sizeMultiple,
    outputNodeId: c.outputNodeId,
    negativePrompt: c.negativePrompt,
  };
}

export function buildComfyAdapter(draft: LocalDraft): VideoProviderAdapter | Veto {
  const model = comfyModelFrom(draft);
  return isVeto(model) ? model : createComfyAdapter({ model });
}

// The registry hook: rebuild an adapter from a stored row.
export function localAdapterFromRow(row: ModelConfigRow): VideoProviderAdapter | Veto | null {
  if (!row.capabilities) return null;
  const token = openToken(row);
  if (isVeto(token)) return token;
  const draft = {
    modelKey: row.id,
    label: row.label ?? row.id,
    capabilities: row.capabilities,
    connection: row.connection,
    token,
  };
  if (row.family === "http") return buildHttpAdapter(draft);
  if (row.family === "comfyui") return buildComfyAdapter(draft);
  return null;
}
