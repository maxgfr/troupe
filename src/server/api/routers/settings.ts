import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import type { ConnectionReport } from "~/modules/generation";
import {
  BUILTIN_MODELS,
  archiveLocalModel,
  canLaunch,
  getDefaultModelKey,
  sanitizeDefaults,
  setDefaultModelKey,
  updateModelPreferences,
  type ModelCatalog,
} from "~/modules/models";
import {
  ApiKey,
  clearProviderKey,
  credentialStatus,
  saveProviderKey,
  type CredentialId,
} from "~/server/settings/providers";
import { SecretUnavailableError } from "~/server/settings/secrets";
import { ChatSettingsPatch, saveChatSettings, type ChatBackend } from "~/modules/chat";
import { MODEL_KEY } from "./generation";
import { localModelProcedures, recordTest } from "./local-models";

const CREDENTIAL = z.enum(["google", "fal", "anthropic"]);

function modelOf(catalog: ModelCatalog, modelKey: string) {
  const model = catalog.models.find((m) => m.key === modelKey);
  if (!model) throw new TRPCError({ code: "NOT_FOUND", message: `Unknown model "${modelKey}".` });
  return model;
}

// A provider account's free check: the key reaches the given model (default:
// the account's first built-in), without generating anything.
async function testCredential(
  catalog: ModelCatalog,
  credential: CredentialId,
  chat: ChatBackend | null,
  modelKey?: string,
): Promise<ConnectionReport> {
  // The chat's key: no video model uses it.
  if (credential === "anthropic")
    return chat ? chat.test("anthropic") : { ok: false, message: "The script chat is not available in this studio." };
  const key = modelKey ?? BUILTIN_MODELS.find((m) => m.credential === credential)!.key;
  const adapter = catalog.adapters.get(key);
  if (!adapter) return { ok: false, message: "No key is configured for this account." };
  if (!adapter.testConnection)
    return { ok: null, message: "This provider has no free check. Launch a short draft to confirm the key." };
  try {
    return await adapter.testConnection();
  } catch {
    return { ok: false, message: "The provider could not be reached. Check this server's network and try again." };
  }
}

function chatBackend(chat: ChatBackend | null): ChatBackend {
  if (!chat)
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The script chat is not available in this studio." });
  return chat;
}

// Personal studio settings: provider accounts, the model catalog and the
// script chat.
export const settingsRouter = createTRPCRouter({
  chat: createTRPCRouter({
    get: protectedProcedure.query(({ ctx }) => chatBackend(ctx.chat).settings()),

    save: protectedProcedure.input(ChatSettingsPatch).mutation(async ({ ctx, input }) => {
      const chat = chatBackend(ctx.chat);
      if (input.provider && input.provider !== "auto" && !chat.offers.includes(input.provider)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This studio cannot use that chat provider." });
      }
      await saveChatSettings(ctx.db, input);
      return chat.settings();
    }),

    test: protectedProcedure
      .input(z.object({ provider: z.enum(["ollama", "anthropic", "webllm"]) }))
      .mutation(({ ctx, input }) => chatBackend(ctx.chat).test(input.provider)),
  }),

  credentials: createTRPCRouter({
    status: protectedProcedure.query(({ ctx }) => credentialStatus(ctx.db)),

    save: protectedProcedure.input(z.object({ provider: CREDENTIAL, key: ApiKey })).mutation(async ({ ctx, input }) => {
      try {
        await saveProviderKey(input, ctx.db);
      } catch (error) {
        if (error instanceof SecretUnavailableError)
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
        throw error;
      }
      return credentialStatus(ctx.db);
    }),

    clear: protectedProcedure
      .input(z.object({ provider: CREDENTIAL, mode: z.enum(["remove", "disable"]) }))
      .mutation(async ({ ctx, input }) => {
        await clearProviderKey(input, ctx.db);
        return credentialStatus(ctx.db);
      }),

    test: protectedProcedure
      .input(z.object({ provider: CREDENTIAL }))
      .mutation(({ ctx, input }) => testCredential(ctx.catalog, input.provider, ctx.chat)),
  }),

  models: createTRPCRouter({
    ...localModelProcedures,
    list: protectedProcedure.query(async ({ ctx }) => ({
      models: ctx.catalog.models,
      defaultModelKey: ctx.catalog.defaultModelKey,
      savedDefaultModelKey: await getDefaultModelKey(ctx.db),
    })),

    update: protectedProcedure
      .input(
        z.object({
          modelKey: MODEL_KEY,
          enabled: z.boolean().optional(),
          defaults: z
            .object({ resolution: z.string(), durationS: z.number().int().positive(), audio: z.boolean() })
            .nullish(),
          pricePerSecondUsd: z.number().min(0).max(100).nullish(),
          timeoutS: z.number().int().min(60).max(86_400).nullish(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const model = modelOf(ctx.catalog, input.modelKey);
        const { modelKey, ...patch } = input;
        await updateModelPreferences(ctx.db, modelKey, {
          ...patch,
          // Never store a default the model cannot honour.
          ...(patch.defaults ? { defaults: sanitizeDefaults(model.capabilities, patch.defaults) } : {}),
        });
      }),

    setDefault: protectedProcedure
      .input(z.object({ modelKey: MODEL_KEY.nullable() }))
      .mutation(async ({ ctx, input }) => {
        if (input.modelKey) {
          const model = modelOf(ctx.catalog, input.modelKey);
          if (!canLaunch(model))
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `${model.label} cannot launch yet: ${model.statusDetail ?? "check it in Settings"}.`,
            });
        }
        await setDefaultModelKey(ctx.db, input.modelKey);
      }),

    // Local models only; built-ins are turned off instead.
    archive: protectedProcedure
      .input(z.object({ modelKey: MODEL_KEY, archived: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const model = modelOf(ctx.catalog, input.modelKey);
        if (model.kind !== "local")
          throw new TRPCError({ code: "BAD_REQUEST", message: "Built-in models can be turned off, not archived." });
        await archiveLocalModel(ctx.db, input.modelKey, input.archived);
        if (input.archived && (await getDefaultModelKey(ctx.db)) === input.modelKey)
          await setDefaultModelKey(ctx.db, null);
      }),

    test: protectedProcedure
      .input(z.object({ modelKey: MODEL_KEY }))
      .mutation(async ({ ctx, input }): Promise<ConnectionReport> => {
        const model = modelOf(ctx.catalog, input.modelKey);
        // Nothing to reach from here (the browser edition, a refused address).
        if (model.status === "unsupported-host")
          return { ok: false, message: model.statusDetail ?? "This model cannot run here." };
        if (model.credential) return testCredential(ctx.catalog, model.credential, ctx.chat, model.key);
        const adapter = ctx.catalog.adapters.get(model.key);
        if (!adapter) return { ok: false, message: model.statusDetail ?? "This model is not configured." };
        if (!adapter.testConnection) return { ok: null, message: "This model has no connection check." };
        let report: ConnectionReport;
        try {
          report = await adapter.testConnection();
        } catch {
          report = { ok: false, message: "The model could not be reached." };
        }
        if (model.kind === "local") await recordTest(ctx.db, model.key, report);
        return report;
      }),
  }),
});
