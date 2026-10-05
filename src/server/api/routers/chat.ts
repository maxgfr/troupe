import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, projectProcedure } from "~/server/api/trpc";
import {
  applyChatProposal,
  ChatMessageNotFoundError,
  chatMessages,
  ChatProviderError,
  listChatMessages,
  NothingToApplyError,
  sendChatMessage,
  StoredProposal,
  type ChatBackend,
} from "~/modules/chat";
import { estimateDurationS, ScriptTooLongError } from "~/modules/script";
import { ActorUnavailableError } from "~/modules/actors";
import { MODEL_KEY } from "./generation";
import { launchText } from "./_launch";

const NO_CHAT = "The script chat is not available in this studio.";

function backend(chat: ChatBackend | null): ChatBackend {
  if (!chat) throw new TRPCError({ code: "PRECONDITION_FAILED", message: NO_CHAT });
  return chat;
}

// Domain errors as tRPC errors; anything else stays an internal error.
function asTrpcError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof ChatProviderError) throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
  if (error instanceof ChatMessageNotFoundError) throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  if (error instanceof NothingToApplyError || error instanceof ScriptTooLongError || error instanceof ActorUnavailableError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  throw error;
}

const LAUNCH = z.object({
  modelKey: MODEL_KEY,
  durationS: z.number().int().positive(),
  resolution: z.string().min(1),
  audio: z.boolean().optional(),
  language: z.string().optional(),
});

// The project's iteration chat: ask for a change, read the proposal against
// the current version, apply it as a new version, and render it at once.
export const chatRouter = createTRPCRouter({
  history: projectProcedure.query(async ({ ctx, input }) => {
    const messages = await listChatMessages(ctx.db, input.projectId);
    if (!ctx.chat) return { messages, provider: null };
    const setup = await ctx.chat.load();
    return { messages, provider: { id: setup.provider, label: setup.label, modelId: setup.modelId, problem: setup.problem, wordsPerSecond: setup.wordsPerSecond } };
  }),

  send: projectProcedure
    .input(z.object({ message: z.string().trim().min(1).max(2000), durationS: z.number().int().min(1).max(600) }))
    .mutation(async ({ ctx, input, signal }) => {
      const setup = await backend(ctx.chat).load();
      try {
        return await sendChatMessage(ctx.db, { projectId: input.projectId, message: input.message, durationS: input.durationS, setup, signal });
      } catch (error) {
        if (signal?.aborted) throw new TRPCError({ code: "CLIENT_CLOSED_REQUEST", message: "The request was stopped." });
        if (error instanceof ChatProviderError) asTrpcError(error);
        // The details stay in the server's log: they may name hosts or data.
        console.error(JSON.stringify({ event: "chat.send.failed", provider: setup.provider, model: setup.modelId, message: (error as Error).message }));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `${setup.label} could not answer. Try again; the server's log has the details.` });
      }
    }),

  // "apply" is a reserved name in tRPC routers.
  applyProposal: projectProcedure
    .input(z.object({ messageId: z.string().uuid() }))
    .mutation(({ ctx, input }) => applyChatProposal(ctx.db, input).catch(asTrpcError)),

  // Apply, then launch the new version with the given settings. A script too
  // long for the clip is refused before anything is applied.
  applyAndLaunch: projectProcedure
    .input(z.object({ messageId: z.string().uuid(), launch: LAUNCH }))
    .mutation(async ({ ctx, input }) => {
      const [message] = await ctx.db
        .select({ proposal: chatMessages.proposal })
        .from(chatMessages)
        .where(and(eq(chatMessages.id, input.messageId), eq(chatMessages.projectId, input.projectId)))
        .limit(1);
      if (!message) asTrpcError(new ChatMessageNotFoundError());
      // Read as applyChatProposal reads it: anything else is nothing to apply.
      const proposal = message.proposal ? StoredProposal.safeParse(message.proposal) : null;
      if (!proposal?.success) asTrpcError(new NothingToApplyError());
      const estimatedS = estimateDurationS(proposal.data.lines.map((l) => l.text).join(" "));
      if (estimatedS > input.launch.durationS) asTrpcError(new ScriptTooLongError(estimatedS, input.launch.durationS));

      const applied = await applyChatProposal(ctx.db, { projectId: input.projectId, messageId: input.messageId }).catch(asTrpcError);
      const generation = await launchText(ctx, { projectId: input.projectId, scriptId: applied.script.id, ...input.launch });
      return { ...applied, generation };
    }),
});
