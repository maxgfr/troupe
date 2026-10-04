import { createCaller } from "~/server/api/root";
import type { Db } from "~/server/db/types";
import type { MediaStore } from "~/server/media/store";
import { serverMedia } from "~/server/media/storage";
import type { VideoProviderAdapter } from "~/modules/generation";
import type { ModelCatalog } from "~/modules/models";
import { catalogOf } from "./adapters";

// Build a tRPC caller with a test context. `userId` defaults to an anonymous
// (null) session; pass fake `adapters` (all ready) or a full `catalog`.
// `media` defaults to the self-hosted store (/api/media links).
export function testCaller(opts: {
  db: Db;
  userId?: string | null;
  adapters?: VideoProviderAdapter[];
  catalog?: ModelCatalog;
  media?: MediaStore;
}) {
  return createCaller({
    db: opts.db,
    media: opts.media ?? serverMedia,
    userId: opts.userId ?? null,
    headers: new Headers(),
    catalog: opts.catalog ?? catalogOf(opts.adapters ?? []),
    ingest: undefined,
  });
}
