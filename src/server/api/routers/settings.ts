import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import type { ConnectionReport } from "~/modules/generation";
import type { Db } from "~/server/db/types";
import {
  BUILTIN_MODELS,
  archiveLocalModel,
  canLaunch,
  getDefaultModelKey,
  getModelConfig,
  updateLocalModel,
  sanitizeDefaults,
  setDefaultModelKey,
  updateModelPreferences,
  type ModelCatalog,
} from "~/modules/models";
import { ApiKey, clearProviderKey, credentialStatus, saveProviderKey, type CredentialId } from "~/server/settings/providers";
import { SecretUnavailableError } from "~/server/settings/secrets";
import { MODEL_KEY } from "./generation";
import { localModelProcedures } from "./local-models";

const CREDENTIAL = z.enum(["google", "fal"]);

// A successful test of an HTTP model saves the polling pace its server asks
// for now (or forgets it when the server stopped asking).
async function rememberPollPace(db: Db, modelKey: string, report: ConnectionReport) {
  if (report.ok !== true) return;
  const row = await getModelConfig(db, modelKey);
  if (row?.family !== "http") return;
  const { pollEveryS: previous, ...rest } = (row.connection ?? {}) as Record<string, unknown>;
  if (previous === report.pollEveryS) return;
  await updateLocalModel(db, modelKey, { connection: { ...rest, ...(report.pollEveryS ? { pollEveryS: report.pollEveryS } : {}) } });
}

function modelOf(catalog: ModelCatalog, modelKey: string) {
  const model = catalog.models.find((m) => m.key === modelKey);
  if (!model) throw new TRPCError({ code: "NOT_FOUND", message: `Unknown model "${modelKey}".` });
  return model;
}

async function testCredential(catalog: ModelCatalog, credential: CredentialId): Promise<ConnectionReport> {
  const model = BUILTIN_MODELS.find((m) => m.credential === credential)!;
  const adapter = catalog.adapters.get(model.key);
  if (!adapter) return { ok: false, message: "No key is configured for this account." };
  if (!adapter.testConnection) {
    // fal.ai has no free endpoint that proves a key can render.
    return { ok: null, message: "fal.ai keys cannot be checked without running a job. Launch a short draft to confirm." };
  }
  try {
    return await adapter.testConnection();
  } catch {
    return { ok: false, message: "The provider could not be reached. Check your network and try again." };
  }
}

// Personal studio settings: provider accounts and the model catalog.
export const settingsRouter = createTRPCRouter({
  credentials: createTRPCRouter({
    status: protectedProcedure.query(({ ctx }) => credentialStatus(ctx.db)),

    save: protectedProcedure
      .input(z.object({ provider: CREDENTIAL, key: ApiKey }))
      .mutation(async ({ ctx, input }) => {
        try {
          await saveProviderKey(input, ctx.db);
        } catch (error) {
          if (error instanceof SecretUnavailableError) throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
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
      .mutation(({ ctx, input }) => testCredential(ctx.catalog, input.provider)),
  }),

  models: createTRPCRouter({
    ...localModelProcedures,
    list: protectedProcedure.query(async ({ ctx }) => ({
      models: ctx.catalog.models,
      defaultModelKey: ctx.catalog.defaultModelKey,
      savedDefaultModelKey: await getDefaultModelKey(ctx.db),
    })),

    update: protectedProcedure
      .input(z.object({
        modelKey: MODEL_KEY,
        enabled: z.boolean().optional(),
        defaults: z.object({ resolution: z.string(), durationS: z.number().int().positive(), audio: z.boolean() }).nullish(),
        pricePerSecondUsd: z.number().min(0).max(100).nullish(),
        timeoutS: z.number().int().min(60).max(86_400).nullish(),
      }))
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
          if (!canLaunch(model)) throw new TRPCError({ code: "BAD_REQUEST", message: `${model.label} cannot launch yet: ${model.statusDetail ?? "check it in Settings"}.` });
        }
        await setDefaultModelKey(ctx.db, input.modelKey);
      }),

    // Local models only; built-ins are turned off instead.
    archive: protectedProcedure
      .input(z.object({ modelKey: MODEL_KEY, archived: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const model = modelOf(ctx.catalog, input.modelKey);
        if (model.kind !== "local") throw new TRPCError({ code: "BAD_REQUEST", message: "Built-in models can be turned off, not archived." });
        await archiveLocalModel(ctx.db, input.modelKey, input.archived);
        if (input.archived && (await getDefaultModelKey(ctx.db)) === input.modelKey) await setDefaultModelKey(ctx.db, null);
      }),

    test: protectedProcedure
      .input(z.object({ modelKey: MODEL_KEY }))
      .mutation(async ({ ctx, input }): Promise<ConnectionReport> => {
        const model = modelOf(ctx.catalog, input.modelKey);
        // Nothing to reach from here (the browser demo, a refused address).
        if (model.status === "unsupported-host") return { ok: false, message: model.statusDetail ?? "This model cannot run here." };
        if (model.credential) return testCredential(ctx.catalog, model.credential);
        const adapter = ctx.catalog.adapters.get(model.key);
        if (!adapter) return { ok: false, message: model.statusDetail ?? "This model is not configured." };
        if (!adapter.testConnection) return { ok: null, message: "This model has no connection check." };
        let report: ConnectionReport;
        try {
          report = await adapter.testConnection();
        } catch {
          return { ok: false, message: "The model could not be reached." };
        }
        await rememberPollPace(ctx.db, model.key, report);
        return report;
      }),
  }),
});
