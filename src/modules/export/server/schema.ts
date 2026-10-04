import { sql } from "drizzle-orm";
import { index, pgPolicy } from "drizzle-orm/pg-core";

import { createTable } from "~/server/db/table";
import { authenticated } from "~/modules/identity/server/schema";
import { projects } from "~/modules/studio/server/schema";
import { generations } from "~/modules/generation/server/schema";

// Every export is an audit record — platform, file, caption,
// disclosure flag and who confirmed quality.
export const exportRecords = createTable(
  "export",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    projectId: d
      .uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    generationId: d
      .uuid()
      .notNull()
      .references(() => generations.id, { onDelete: "cascade" }),
    platform: d.text({ enum: ["instagram", "youtube", "tiktok", "linkedin"] }).notNull(),
    filePath: d.text().notNull(),
    caption: d.text().notNull(),
    hashtags: d.text().array().notNull(),
    aiDisclosure: d.boolean().notNull().default(true),
    qualityConfirmedBy: d.uuid(),
    approvalId: d.uuid(),
    createdAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (t) => [
    index("export_project_idx").on(t.projectId),
    pgPolicy("export_member_select", {
      for: "select",
      to: authenticated,
      using: sql`exists (select 1 from troupe_project p join troupe_workspace_member m on m."workspaceId" = p."workspaceId" where p.id = ${t.projectId} and m."userId" = auth.uid())`,
    }),
  ],
).enableRLS();
