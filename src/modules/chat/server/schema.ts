import { sql } from "drizzle-orm";
import { index, pgPolicy } from "drizzle-orm/pg-core";

import { createTable } from "~/server/db/table";
import { authenticated } from "~/modules/identity/server/schema";
import { scripts } from "~/modules/script/server/schema";
import { projects } from "~/modules/studio/server/schema";
import type { Proposal } from "../proposal";

// The iteration chat of a project: the user's requests and the model's
// proposals. A proposal becomes a script version only when applied.
export const chatMessages = createTable(
  "chat_message",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    projectId: d
      .uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    role: d.text({ enum: ["user", "assistant"] }).notNull(),
    // The user's words, the model's summary, or the model's raw answer when
    // it could not be read as a script (proposal null).
    content: d.text().notNull(),
    proposal: d.jsonb().$type<Proposal>(),
    // The version the request was made on: a newer one makes it outdated.
    baseScriptId: d.uuid().references(() => scripts.id, { onDelete: "set null" }),
    // The version created by applying the proposal.
    appliedScriptId: d.uuid().references(() => scripts.id, { onDelete: "set null" }),
    // Who answered: "ollama", "anthropic" or "webllm", and the model id.
    provider: d.text(),
    model: d.text(),
    createdAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (t) => [
    index("chat_message_project_idx").on(t.projectId, t.createdAt),
    pgPolicy("chat_message_member_select", {
      for: "select",
      to: authenticated,
      using: sql`exists (select 1 from troupe_project p join troupe_workspace_member m on m."workspaceId" = p."workspaceId" where p.id = ${t.projectId} and m."userId" = auth.uid())`,
    }),
  ],
).enableRLS();
