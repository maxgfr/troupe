import { sql } from "drizzle-orm";
import { index, pgPolicy } from "drizzle-orm/pg-core";

import { createTable } from "~/server/db/table";
import { authenticated, workspaces } from "~/modules/identity/server/schema";
import { generations } from "~/modules/generation/server/schema";

// One run groups one generation per provider for a single brief.
export const benchmarkRuns = createTable(
  "benchmark_run",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    workspaceId: d
      .uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    brief: d.text().notNull(),
    createdAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (t) => [
    pgPolicy("benchmark_run_member_select", {
      for: "select",
      to: authenticated,
      using: sql`exists (select 1 from troupe_workspace_member m where m."workspaceId" = ${t.workspaceId} and m."userId" = auth.uid())`,
    }),
  ],
).enableRLS();

export const benchmarkEntries = createTable(
  "benchmark_entry",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    benchmarkRunId: d
      .uuid()
      .notNull()
      .references(() => benchmarkRuns.id, { onDelete: "cascade" }),
    generationId: d
      .uuid()
      .notNull()
      .references(() => generations.id, { onDelete: "cascade" }),
    // userId → integer score 1–5.
    qualityVotes: d.jsonb().$type<Record<string, number>>().notNull().default({}),
  }),
  (t) => [index("benchmark_entry_run_idx").on(t.benchmarkRunId)],
).enableRLS();
