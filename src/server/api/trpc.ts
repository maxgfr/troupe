/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1).
 * 2. You want to create a new middleware or type of procedure (see Part 3).
 *
 * TL;DR - This is where all the tRPC server stuff is created and plugged in. The pieces you will
 * need to use are documented accordingly near the end.
 */
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { z, ZodError } from "zod";

import { eq } from "drizzle-orm";

import type { Db } from "~/server/db/types";
import type { MediaStore } from "~/server/media/store";
import { assertMembership } from "~/modules/identity/server/service";
import { projects } from "~/modules/studio";
import type { RenderIngestor } from "~/modules/generation";
import type { ModelCatalog } from "~/modules/models";
import type { Machine } from "~/server/settings/urls";
import type { ChatBackend } from "~/modules/chat";

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 *
 * This helper generates the "internals" for a tRPC context. The API handler and RSC clients each
 * wrap this and provides the required context.
 *
 * @see https://trpc.io/docs/server/context
 */
export const createTRPCContext = async (opts: {
  headers: Headers;
  // Driver-agnostic handle: production is postgres-js, tests inject pglite.
  // Passed in rather than imported so the router never opens a connection
  // by itself.
  db: Db;
  // Links to stored renders and their deletion (src/server/media/store.ts).
  media: MediaStore;
  userId?: string | null;
  catalog?: ModelCatalog;
  ingest?: RenderIngestor;
  // The machine the server runs on, for suggestions such as ComfyUI's
  // address. Null where there is none to inspect (the browser edition).
  machine?: Machine | null;
  // The script chat's model: Ollama or Claude here (src/server/chat), WebLLM
  // in the browser edition. Null where none is wired (most tests).
  chat?: ChatBackend | null;
}) => {
  return {
    db: opts.db,
    media: opts.media,
    userId: opts.userId ?? null,
    headers: opts.headers,
    // The model catalog and its adapters (src/server/adapters.ts). Tests
    // inject fakes; empty when nothing is configured.
    catalog: opts.catalog ?? EMPTY_CATALOG,
    ingest: opts.ingest,
    machine: opts.machine ?? null,
    chat: opts.chat ?? null,
  };
};

const EMPTY_CATALOG: ModelCatalog = { models: [], adapters: new Map(), defaultModelKey: null };

/**
 * 2. INITIALIZATION
 *
 * This is where the tRPC API is initialized, connecting the context and transformer. We also parse
 * ZodErrors so that you get typesafety on the frontend if your procedure fails due to validation
 * errors on the backend.
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  // The browser edition (site/) runs this router in the browser, behind a
  // local link.
  allowOutsideOfServer: true,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

/**
 * Create a server-side caller.
 *
 * @see https://trpc.io/docs/server/server-side-calls
 */
export const createCallerFactory = t.createCallerFactory;

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these a lot in the
 * "/src/server/api/routers" directory.
 */

/**
 * This is how you create new routers and sub-routers in your tRPC API.
 *
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

// Logs procedure timings in development.
const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();
  const result = await next();

  const end = Date.now();
  const line = timingLine(path, end - start, t._config.isDev);
  if (line) console.log(line);

  return result;
});

// Timing is a dev aid — outside development the hot path stays
// silent (null), so production requests never pay per-call console noise.
export function timingLine(path: string, ms: number, isDev: boolean): string | null {
  return isDev ? `[TRPC] ${path} took ${ms}ms to execute` : null;
}

/**
 * Public (unauthenticated) procedure
 *
 * This is the base piece you use to build new queries and mutations on your tRPC API. It does not
 * guarantee that a user querying is authorized, but you can still access user session data if they
 * are logged in.
 */
export const publicProcedure = t.procedure.use(timingMiddleware);

/**
 * Requires a user (the local studio user, resolved by the request context).
 */
export const protectedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED", message: "sign in first" });
  return next({ ctx: { ...ctx, userId: ctx.userId } });
});

/**
 * Every workspace-scoped procedure resolves membership or fails
 * closed with FORBIDDEN — before the handler ever runs.
 */
export const workspaceProcedure = protectedProcedure.input(z.object({ workspaceId: z.string().uuid() })).use(async ({ ctx, input, next }) => {
  try {
    await assertMembership(ctx.db, { workspaceId: (input as { workspaceId: string }).workspaceId, userId: ctx.userId! });
  } catch {
    throw new TRPCError({ code: "FORBIDDEN", message: "not a member of this workspace" });
  }
  return next();
});

/**
 * For resource-scoped calls: a procedure keyed by `projectId`
 * resolves the project's owning workspace and asserts membership before the
 * handler runs. A missing project is NOT_FOUND; a non-member is FORBIDDEN —
 * never data. Exposes the resolved `workspaceId` on ctx for the handler.
 */
export const projectProcedure = protectedProcedure.input(z.object({ projectId: z.string().uuid() })).use(async ({ ctx, input, next }) => {
  const projectId = (input as { projectId: string }).projectId;
  const [project] = await ctx.db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "project not found" });
  try {
    await assertMembership(ctx.db, { workspaceId: project.workspaceId, userId: ctx.userId! });
  } catch {
    throw new TRPCError({ code: "FORBIDDEN", message: "not a member of this project's workspace" });
  }
  return next({ ctx: { ...ctx, workspaceId: project.workspaceId } });
});
