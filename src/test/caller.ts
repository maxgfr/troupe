import { createCaller } from "~/server/api/root";
import type { Db } from "~/server/db/types";
import type { VideoProviderAdapter } from "~/modules/generation";
import type { ModelCatalog } from "~/modules/models";
import { catalogOf } from "./adapters";

// Build a tRPC caller with a test context. `userId` defaults to an anonymous
// (null) session; pass fake `adapters` (all ready) or a full `catalog`.
export function testCaller(opts: {
  db: Db;
  userId?: string | null;
  adapters?: VideoProviderAdapter[];
  catalog?: ModelCatalog;
}) {
  return createCaller({
    db: opts.db,
    userId: opts.userId ?? null,
    headers: new Headers(),
    catalog: opts.catalog ?? catalogOf(opts.adapters ?? []),
    ingest: undefined,
  });
}
