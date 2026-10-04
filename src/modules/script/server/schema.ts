import { sql } from "drizzle-orm";
import { index, pgPolicy, uniqueIndex } from "drizzle-orm/pg-core";

import { createTable } from "~/server/db/table";
import { authenticated } from "~/modules/identity/server/schema";
import { projects } from "~/modules/studio/server/schema";

// Script versions are immutable — retagging a line appends a new
// version, so the history is the row set itself.
export const scripts = createTable(
  "script",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    projectId: d
      .uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: d.integer().notNull(),
    origin: d.text({ enum: ["chat", "pasted"] }).notNull(),
    // Word count ÷ 2.5 words/second, recomputed whenever lines change.
    estimatedDurationS: d.integer().notNull(),
    status: d.text({ enum: ["draft", "final"] }).notNull().default("draft"),
    createdAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (t) => [
    uniqueIndex("script_project_version_unique").on(t.projectId, t.version),
    pgPolicy("script_member_select", {
      for: "select",
      to: authenticated,
      using: sql`exists (select 1 from troupe_project p join troupe_workspace_member m on m."workspaceId" = p."workspaceId" where p.id = ${t.projectId} and m."userId" = auth.uid())`,
    }),
  ],
).enableRLS();

export const scriptLines = createTable(
  "script_line",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    scriptId: d
      .uuid()
      .notNull()
      .references(() => scripts.id, { onDelete: "cascade" }),
    index: d.integer().notNull(),
    role: d.text({ enum: ["hook", "body", "cta"] }).notNull(),
    text: d.text().notNull(),
    emotion: d.text({ enum: ["neutral", "excited", "calm", "serious", "happy", "disappointed"] }).notNull(),
  }),
  (t) => [
    index("script_line_script_idx").on(t.scriptId, t.index),
    pgPolicy("script_line_member_select", {
      for: "select",
      to: authenticated,
      using: sql`exists (select 1 from troupe_script s join troupe_project p on p.id = s."projectId" join troupe_workspace_member m on m."workspaceId" = p."workspaceId" where s.id = ${t.scriptId} and m."userId" = auth.uid())`,
    }),
  ],
).enableRLS();
