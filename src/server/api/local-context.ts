import "server-only";

import { ensureLocalStudio, LOCAL_USER_ID } from "~/modules/identity";
import { loadModelCatalog } from "~/server/adapters";
import { persistProviderRender, serverMedia } from "~/server/media/storage";
import { db as runtimeDb } from "~/server/db";
import type { Db } from "~/server/db/types";
import { createTRPCContext } from "./trpc";

export { assertStudioRequest as assertLocalRequest } from "./access";
import { assertStudioRequest } from "./access";

// The self-hosted studio's database: the one Postgres connection.
const db = runtimeDb as Db;
let initialization: Promise<unknown> | undefined;

export async function createLocalContext(headers: Headers) {
  assertStudioRequest(headers);
  initialization ??= ensureLocalStudio(db).catch((error: unknown) => {
    initialization = undefined;
    throw error;
  });
  await initialization;
  return createTRPCContext({ headers, db, media: serverMedia, userId: LOCAL_USER_ID, catalog: await loadModelCatalog(db), ingest: persistProviderRender });
}
