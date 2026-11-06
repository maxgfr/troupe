import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import type { ConnectionReport } from "~/modules/generation";
import {
  BUILTIN_MODELS,
  CATALOG_PROVIDERS,
  archiveLocalModel,
  type CatalogProviderId,
  canLaunch,
  getDefaultModelKey,
  sanitizeDefaults,
  setDefaultModelKey,
  updateModelPreferences,
  type ModelCatalog,
} from "~/modules/models";
import { testVideoKey } from "llm-connect/video";

import type { Db } from "~/server/db/types";
import {
  addCatalogVideoModel,
  listCatalogVideoModels,
  toCatalogEntry,
  VideoCatalogError,
} from "~/server/video-catalog";
import {
  ApiKey,
  CREDENTIAL_IDS,
  clearProviderKey,
  credentialStatus,
  saveProviderKey,
  type CredentialId,
} from "~/server/settings/providers";
import { SecretUnavailableError } from "~/server/settings/secrets";
import { readCredentials } from "~/server/settings/providers";
import { addFalModel, FalCatalogError, falHttp as httpFetch, listFalVideoModels } from "~/server/fal-catalog";
import { ChatSettingsPatch, saveChatSettings, type ChatBackend } from "~/modules/chat";
import { MODEL_KEY } from "./generation";
import { localModelProcedures, recordTest } from "./local-models";

const CREDENTIAL = z.enum(CREDENTIAL_IDS);
const CATALOG_PROVIDER = z.enum(CATALOG_PROVIDERS);

function modelOf(catalog: ModelCatalog, modelKey: string) {
  const model = catalog.models.find((m) => m.key === modelKey);
  if (!model) throw new TRPCError({ code: "NOT_FOUND", message: `Unknown model "${modelKey}".` });
  return model;
}

// A provider account's free check: the key reaches the given model (default:
// the account's first built-in), without generating anything.
async function testCredential(
  db: Db,
  catalog: ModelCatalog,
  credential: CredentialId,
  chat: ChatBackend | null,
  modelKey?: string,
): Promise<ConnectionReport> {
  // The chat's key: no video model uses it.
  if (credential === "anthropic")
    return chat ? chat.test("anthropic") : { ok: false, message: "The script chat is not available in this studio." };
  const builtin = BUILTIN_MODELS.find((m) => m.credential === credential);
  // An account without a built-in (OpenRouter, xAI…): ask its API about the key.
  if (!modelKey && !builtin) {
    const state = (await readCredentials(db))[credential];
    if (state.source !== "saved" && state.source !== "environment")
      return { ok: false, message: "No key is configured for this account." };
    return testVideoKey({ provider: credential as CatalogProviderId, apiKey: state.key });
  }
  const key = modelKey ?? builtin!.key;
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

// The saved keys that widen the video catalog: Google's Veo models and
// Replicate's collection need one to be listed.
async function catalogKeys(db: Db): Promise<{ google?: string; replicate?: string }> {
  const credentials = await readCredentials(db);
  const keyOf = (id: "google" | "replicate") => {
    const c = credentials[id];
    return c.source === "saved" || c.source === "environment" ? c.key : undefined;
  };
  return { google: keyOf("google"), replicate: keyOf("replicate") };
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
      .mutation(({ ctx, input }) => testCredential(ctx.db, ctx.catalog, input.provider, ctx.chat)),
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

    // fal.ai's text-to-video catalog, live (cached a quarter of an hour), each
    // model marked when it is already in the studio.
    falCatalog: protectedProcedure.query(async ({ ctx }) => {
      try {
        const entries = await listFalVideoModels(httpFetch);
        const added = new Map(
          ctx.catalog.models.filter((m) => m.family === "fal" && !m.archived).map((m) => [m.modelId, m.key]),
        );
        return entries.map((e) => ({ ...e, modelKey: added.get(e.endpoint) ?? null }));
      } catch (error) {
        if (error instanceof FalCatalogError) throw new TRPCError({ code: "BAD_GATEWAY", message: error.message });
        throw new TRPCError({ code: "BAD_GATEWAY", message: "fal.ai's model list could not be reached." });
      }
    }),

    // Add a model from fal.ai's catalog: its settings come from its schema.
    addFal: protectedProcedure
      .input(z.object({ endpoint: z.string().min(3).max(200) }))
      .mutation(async ({ ctx, input }) => {
        // A built-in on that endpoint is already there; an added one is read again.
        const builtin = ctx.catalog.models.find(
          (m) => m.modelId === input.endpoint && BUILTIN_MODELS.some((b) => b.key === m.key),
        );
        if (builtin) return { modelKey: builtin.key, label: builtin.label };
        const fal = (await readCredentials(ctx.db)).fal;
        try {
          return await addFalModel(ctx.db, {
            endpoint: input.endpoint,
            http: httpFetch,
            apiKey: fal.source === "saved" || fal.source === "environment" ? fal.key : null,
          });
        } catch (error) {
          if (error instanceof FalCatalogError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
          throw error;
        }
      }),

    // The video models of OpenRouter, the AI Gateway, xAI, Google and
    // Replicate (llm-models), live (cached a quarter of an hour), each marked
    // when it is already in the studio. Saved Google and Replicate keys
    // widen the list.
    videoCatalog: protectedProcedure.query(async ({ ctx }) => {
      const keys = await catalogKeys(ctx.db);
      let models: Awaited<ReturnType<typeof listCatalogVideoModels>>;
      try {
        models = await listCatalogVideoModels(keys);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: error instanceof VideoCatalogError ? error.message : "The video model lists could not be reached.",
        });
      }
      const added = new Map(
        ctx.catalog.models
          .filter((m) => m.family === "catalog" && !m.archived)
          .map((m) => [`${m.credential}:${m.modelId}`, m.key]),
      );
      return models.map((m) => ({
        ...toCatalogEntry(m),
        modelKey: added.get(`${m.provider}:${m.id}`) ?? null,
      }));
    }),

    // Add a model from a provider's list: its settings come from the list.
    addVideo: protectedProcedure
      .input(z.object({ provider: CATALOG_PROVIDER, id: z.string().min(1).max(200) }))
      .mutation(async ({ ctx, input }) => {
        try {
          const models = await listCatalogVideoModels(await catalogKeys(ctx.db));
          return await addCatalogVideoModel(ctx.db, { ...input, models });
        } catch (error) {
          if (error instanceof VideoCatalogError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
          throw error;
        }
      }),

    // Local models and the ones added from fal.ai's catalog; built-ins are
    // turned off instead.
    archive: protectedProcedure
      .input(z.object({ modelKey: MODEL_KEY, archived: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const model = modelOf(ctx.catalog, input.modelKey);
        if (BUILTIN_MODELS.some((b) => b.key === model.key))
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
        if (model.credential) return testCredential(ctx.db, ctx.catalog, model.credential, ctx.chat, model.key);
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
