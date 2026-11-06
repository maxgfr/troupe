import { sql } from "drizzle-orm";
import { index, pgPolicy, uniqueIndex } from "drizzle-orm/pg-core";

import { createTable } from "~/server/db/table";
import { authenticated, workspaces } from "~/modules/identity/server/schema";

// A project pins the four wizard choices (format, platform, language,
// actor) and everything else hangs off it.
export const projects = createTable(
  "project",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    workspaceId: d
      .uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: d.text().notNull(),
    format: d.text({ enum: ["9:16", "1:1", "16:9"] }).notNull(),
    platform: d.text({ enum: ["instagram", "youtube", "tiktok", "linkedin"] }).notNull(),
    language: d.text().notNull(), // BCP 47
    actorId: d.uuid(),
    // The model this project launches on by default (null: studio default).
    modelKey: d.text(),
    status: d
      .text({ enum: ["draft", "scripting", "generating", "review", "done"] })
      .notNull()
      .default("draft"),
    // "shots": the workspace's hidden project that holds its Shots renders
    // (free-form text, no script). It never appears in the projects list.
    kind: d
      .text({ enum: ["project", "shots"] })
      .notNull()
      .default("project"),
    createdAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (t) => [
    index("project_workspace_idx").on(t.workspaceId),
    uniqueIndex("project_one_shots_idx").on(t.workspaceId).where(sql`${t.kind} = 'shots'`),
    pgPolicy("project_member_select", {
      for: "select",
      to: authenticated,
      using: sql`exists (select 1 from troupe_workspace_member m where m."workspaceId" = ${t.workspaceId} and m."userId" = auth.uid())`,
    }),
  ],
).enableRLS();
