import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { type createTRPCContext, createTRPCRouter, workspaceProcedure } from "~/server/api/trpc";
import { getChatSettings } from "~/modules/chat";
import type { Db } from "~/server/db/types";
import {
  AssistantError,
  openRouterAssistantModel,
  runAssistant,
  type AssistantMessage,
  type AssistantModel,
  type RunResult,
} from "~/server/assistant/loop";
import { ASSISTANT_SYSTEM_PROMPT, ASSISTANT_TOOLS } from "~/server/assistant/tools";
import { DEFAULT_OPENROUTER_CHAT_MODEL } from "~/server/chat/openrouter";
import { readCredentials } from "~/server/settings/providers";

// The studio assistant (src/server/assistant): a conversation that drives the
// studio with tools, on the user's OpenRouter key. The page keeps the
// conversation and sends it whole with each turn; nothing is stored here.

const TOOL_CALL = z.object({
  id: z.string().min(1).max(200),
  type: z.literal("function"),
  function: z.object({ name: z.string().min(1).max(100), arguments: z.string().max(20_000) }),
});

const MESSAGE = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), content: z.string().trim().min(1).max(8000) }),
  z.object({
    role: z.literal("assistant"),
    content: z.string().max(20_000).nullable(),
    tool_calls: z.array(TOOL_CALL).max(10).optional(),
  }),
  z.object({ role: z.literal("tool"), tool_call_id: z.string().min(1).max(200), content: z.string().max(20_000) }),
]);

const MESSAGES = z.array(MESSAGE).min(1).max(120);

// Who answers: the OpenRouter model of the script chat's settings (any
// model with tool calling), on the saved OpenRouter key.
async function assistantSetup(db: Db) {
  const [saved, credentials] = await Promise.all([getChatSettings(db), readCredentials(db)]);
  const c = credentials.openrouter;
  const apiKey = c.source === "saved" || c.source === "environment" ? c.key : null;
  return { apiKey, model: saved.openrouterModel ?? DEFAULT_OPENROUTER_CHAT_MODEL };
}

// Tests pass a fake model.
let modelOverride: AssistantModel | null = null;
export function setAssistantModelForTests(model: AssistantModel | null) {
  modelOverride = model;
}

// The router's context. Typed here, not through the root router (which
// includes this one), so the app router's type stays whole.
type Context = Awaited<ReturnType<typeof createTRPCContext>>;

async function run(
  ctx: Context,
  input: { workspaceId: string; messages: AssistantMessage[]; decision?: { toolCallId: string; approve: boolean } },
): Promise<RunResult> {
  const setup = await assistantSetup(ctx.db);
  if (!setup.apiKey && !modelOverride)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The assistant needs an OpenRouter key. Add one under Settings → Provider accounts.",
    });
  // Loaded here: the root router imports this one.
  const { createCaller } = await import("~/server/api/root");
  try {
    return await runAssistant({
      system: ASSISTANT_SYSTEM_PROMPT,
      messages: input.messages,
      tools: ASSISTANT_TOOLS,
      ctx: { caller: createCaller(ctx), workspaceId: input.workspaceId },
      model: modelOverride ?? openRouterAssistantModel({ apiKey: setup.apiKey!, model: setup.model }),
      decision: input.decision,
    });
  } catch (error) {
    if (error instanceof AssistantError) throw new TRPCError({ code: "BAD_GATEWAY", message: error.message });
    throw error;
  }
}

export const assistantRouter = createTRPCRouter({
  // Whether it can answer, and with which model.
  status: workspaceProcedure.query(async ({ ctx }) => {
    const setup = await assistantSetup(ctx.db);
    return {
      ready: Boolean(setup.apiKey),
      model: setup.model,
      problem: setup.apiKey
        ? null
        : "The assistant needs an OpenRouter key. Add one under Settings → Provider accounts.",
    };
  }),

  // The user's turn: the conversation so far, ending with their message.
  send: workspaceProcedure.input(z.object({ messages: MESSAGES })).mutation(({ ctx, input }) => {
    if (input.messages.at(-1)?.role !== "user")
      throw new TRPCError({ code: "BAD_REQUEST", message: "The conversation must end with your message." });
    return run(ctx, { workspaceId: input.workspaceId, messages: input.messages as AssistantMessage[] });
  }),

  // Confirm or cancel the paid action the assistant is waiting on, then go on.
  decide: workspaceProcedure
    .input(z.object({ messages: MESSAGES, toolCallId: z.string().min(1).max(200), approve: z.boolean() }))
    .mutation(({ ctx, input }) =>
      run(ctx, {
        workspaceId: input.workspaceId,
        messages: input.messages as AssistantMessage[],
        decision: { toolCallId: input.toolCallId, approve: input.approve },
      }),
    ),
});
