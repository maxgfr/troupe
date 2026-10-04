import "server-only";

import { ensureLocalStudio, LOCAL_USER_ID } from "~/modules/identity";
import { loadModelCatalog } from "~/server/adapters";
import { persistProviderRender } from "~/server/media/storage";
import { db } from "~/server/db";
import type { Db } from "~/server/db/types";
import { createTRPCContext } from "./trpc";

export { assertStudioRequest as assertLocalRequest } from "./access";
import { assertStudioRequest } from "./access";

let initialization: Promise<unknown> | undefined;

export async function createLocalContext(headers: Headers) {
  assertStudioRequest(headers);
  initialization ??= ensureLocalStudio(db as Db).catch((error: unknown) => {
    initialization = undefined;
    throw error;
  });
  await initialization;
  return createTRPCContext({ headers, userId: LOCAL_USER_ID, catalog: await loadModelCatalog(), ingest: persistProviderRender });
}
