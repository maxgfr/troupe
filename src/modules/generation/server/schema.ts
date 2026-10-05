import { sql } from "drizzle-orm";
import { index, pgPolicy, uniqueIndex } from "drizzle-orm/pg-core";

import { createTable } from "~/server/db/table";
import { authenticated } from "~/modules/identity/server/schema";
import { projects } from "~/modules/studio/server/schema";

// One row per provider job — reproducible and attributable (provider,
// modelId, prompt, cost).
export const generations = createTable(
  "generation",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    projectId: d
      .uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Catalog key that routes polls; provider stays as the vendor label.
    modelKey: d.text().notNull(),
    provider: d.text().notNull(),
    modelId: d.text().notNull(),
    inputMode: d.text({ enum: ["text", "photo", "video"] }).notNull(),
    tier: d.text({ enum: ["draft", "final"] }).notNull(),
    inputAssetId: d.uuid(),
    scriptId: d.uuid(),
    // The actor and the exact portrait-set version seeding it.
    actorId: d.uuid(),
    actorAssetVersion: d.integer(),
    prompt: d.text().notNull(),
    aspectRatio: d.text().notNull(),
    durationS: d.integer().notNull(),
    resolution: d.text().notNull(),
    status: d.text({ enum: ["queued", "in_progress", "completed", "failed"] }).notNull().default("queued"),
    providerJobId: d.text(),
    costUsd: d.numeric(),
    // "estimate": price × duration at launch; "provider": reported upstream.
    costSource: d.text({ enum: ["estimate", "provider"] }),
    creditsDebited: d.integer().notNull().default(0),
    outputAssetId: d.uuid(),
    errorCode: d.text(),
    // A readable explanation of a failure, never an upstream body.
    errorDetail: d.text(),
    language: d.text(),
    // The share of the job done (0–1) as the model last reported it while
    // the job ran; null when it reports none.
    progress: d.real(),
    // The model drew the script's captions into the picture itself, so the
    // player does not turn its own captions track on.
    burnedCaptions: d.boolean().notNull().default(false),
    // The failed render this one relaunched.
    parentGenerationId: d.uuid(),
    createdAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
    completedAt: d.timestamp({ withTimezone: true }),
  }),
  (t) => [
    index("generation_project_idx").on(t.projectId),
    index("generation_provider_job_idx").on(t.provider, t.providerJobId),
    // One relaunch per failed render, even when two arrive at once.
    uniqueIndex("generation_one_relaunch_idx").on(t.parentGenerationId).where(sql`${t.parentGenerationId} is not null`),
    pgPolicy("generation_member_select", {
      for: "select",
      to: authenticated,
      using: sql`exists (select 1 from troupe_project p join troupe_workspace_member m on m."workspaceId" = p."workspaceId" where p.id = ${t.projectId} and m."userId" = auth.uid())`,
    }),
  ],
).enableRLS();

// One row per generation awaiting its provider outcome — the
// reconciler claims due rows (FOR UPDATE SKIP LOCKED) and polls the provider;
// the terminal transition deletes the row. Server-only table.
export const generationWatches = createTable(
  "generation_watch",
  (d) => ({
    generationId: d
      .uuid()
      .primaryKey()
      .references(() => generations.id, { onDelete: "cascade" }),
    modelKey: d.text().notNull(),
    providerJobId: d.text().notNull(),
    attempts: d.integer().notNull().default(0),
    nextPollAt: d.timestamp({ withTimezone: true }).notNull(),
    // Fixed at submission from the model's timeout: a local GPU queue may
    // legitimately take hours, a cloud API should not.
    deadlineAt: d.timestamp({ withTimezone: true }).notNull(),
    createdAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (t) => [index("generation_watch_due_idx").on(t.nextPollAt)],
).enableRLS();
