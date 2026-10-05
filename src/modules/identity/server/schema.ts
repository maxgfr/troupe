import { sql } from "drizzle-orm";
import { index, pgPolicy, pgRole, uniqueIndex } from "drizzle-orm/pg-core";

import { createTable } from "~/server/db/table";

// Supabase's built-in role — exists in every Supabase project (created by the
// test shim in pglite). Policies target it; the service role bypasses RLS.
export const authenticated = pgRole("authenticated").existing();

// Profile row mirroring auth.users. No FK to auth.users so tests and
// local tooling don't depend on Supabase's internal schema. Row level
// security with no policy: Supabase's Data API (anon and authenticated keys)
// can neither read nor write it; the app's connection owns the table.
export const users = createTable("user", (d) => ({
  id: d.uuid().primaryKey(),
  email: d.text().notNull(),
  displayName: d.text(),
  createdAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
})).enableRLS();

export const workspaces = createTable(
  "workspace",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    name: d.text().notNull(),
    ownerId: d.uuid().notNull(),
    createdAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (t) => [
    // Tenant isolation lives in Postgres. A workspace row is only
    // visible to its members (the subquery is itself RLS-scoped to own rows).
    pgPolicy("workspace_member_select", {
      for: "select",
      to: authenticated,
      using: sql`exists (select 1 from troupe_workspace_member m where m."workspaceId" = ${t.id} and m."userId" = auth.uid())`,
    }),
  ],
).enableRLS();

export const workspaceMembers = createTable(
  "workspace_member",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    workspaceId: d
      .uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: d.uuid().notNull(),
    role: d.text({ enum: ["owner", "editor", "reviewer"] }).notNull(),
  }),
  (t) => [
    uniqueIndex("workspace_member_unique").on(t.workspaceId, t.userId),
    index("workspace_member_user_idx").on(t.userId),
    // Members see their own membership rows only — non-recursive base case for
    // the workspace policy above.
    pgPolicy("workspace_member_self_select", {
      for: "select",
      to: authenticated,
      using: sql`${t.userId} = auth.uid()`,
    }),
  ],
).enableRLS();
