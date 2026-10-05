import { sql } from "drizzle-orm";
import { index, pgPolicy } from "drizzle-orm/pg-core";

import { createTable } from "~/server/db/table";
import { authenticated } from "~/modules/identity/server/schema";

// Stored media: generated renders, the inspiration library's files (kind
// "library", the original; "frame", a picture taken from a video) and, on
// older installs, portraits and uploads.
export const mediaAssets = createTable(
  "media_asset",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    workspaceId: d.uuid().notNull(),
    kind: d.text({ enum: ["photo", "video", "render", "portrait", "consent", "library", "frame"] }).notNull(),
    storagePath: d.text().notNull(),
    mimeType: d.text().notNull(),
    bytes: d.bigint({ mode: "number" }).notNull(),
    checksum: d.text().notNull(),
    // Probed by the media finalizer on upload AND on render ingestion.
    meta: d.jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (t) => [
    index("media_asset_workspace_idx").on(t.workspaceId),
    pgPolicy("media_asset_member_select", {
      for: "select",
      to: authenticated,
      using: sql`exists (select 1 from troupe_workspace_member m where m."workspaceId" = ${t.workspaceId} and m."userId" = auth.uid())`,
    }),
  ],
).enableRLS();

export type MediaProbe = (input: { storagePath: string; mimeType: string }) => Promise<Record<string, unknown>>;
