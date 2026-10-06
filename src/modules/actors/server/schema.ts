import { sql } from "drizzle-orm";
import { index, pgPolicy } from "drizzle-orm/pg-core";

import { createTable } from "~/server/db/table";
import { authenticated } from "~/modules/identity/server/schema";

// Fully synthetic actors; consistency = same versioned
// portrait set as image-to-video seed (bumping the set bumps assetVersion).
export const actors = createTable(
  "actor",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    // null = global library actor; set = workspace-private custom actor.
    workspaceId: d.uuid(),
    name: d.text().notNull(),
    gender: d.text({ enum: ["female", "male", "nonbinary"] }).notNull(),
    ageRange: d.text().notNull(),
    style: d.text().notNull(),
    // Delivery description compiled into the provider's native-audio prompt.
    voiceProfile: d.text().notNull(),
    kind: d.text({ enum: ["library", "custom"] }).notNull(),
    consentRef: d.uuid(),
    assetVersion: d.integer().notNull().default(1),
    status: d
      .text({ enum: ["active", "unavailable"] })
      .notNull()
      .default("active"),
    createdAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (t) => [
    index("actor_workspace_idx").on(t.workspaceId),
    pgPolicy("actor_visible_select", {
      for: "select",
      to: authenticated,
      using: sql`${t.workspaceId} is null or exists (select 1 from troupe_workspace_member m where m."workspaceId" = ${t.workspaceId} and m."userId" = auth.uid())`,
    }),
  ],
).enableRLS();

export const actorAssets = createTable(
  "actor_asset",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    actorId: d
      .uuid()
      .notNull()
      .references(() => actors.id, { onDelete: "cascade" }),
    kind: d.text({ enum: ["portrait", "angle", "emotion"] }).notNull(),
    emotion: d.text(),
    storagePath: d.text().notNull(),
    version: d.integer().notNull().default(1),
  }),
  (t) => [
    index("actor_asset_actor_idx").on(t.actorId, t.version),
    pgPolicy("actor_asset_visible_select", {
      for: "select",
      to: authenticated,
      using: sql`exists (select 1 from troupe_actor a where a.id = ${t.actorId} and (a."workspaceId" is null or exists (select 1 from troupe_workspace_member m where m."workspaceId" = a."workspaceId" and m."userId" = auth.uid())))`,
    }),
  ],
).enableRLS();
