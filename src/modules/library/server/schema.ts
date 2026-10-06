import { sql } from "drizzle-orm";
import { index, pgPolicy } from "drizzle-orm/pg-core";

import { createTable } from "~/server/db/table";
import { authenticated, workspaces } from "~/modules/identity/server/schema";
import { mediaAssets } from "~/modules/generation/server/media";
import { projects } from "~/modules/studio/server/schema";
import type { DraftLine } from "~/modules/script";
import type { Citation, ItemAnalysis } from "../model";

const memberOf = (workspaceId: unknown) => sql`exists (select 1 from troupe_workspace_member m where m."workspaceId" = ${workspaceId} and m."userId" = auth.uid())`;

// Something the user saved for inspiration: a file, a pasted text or a link.
// The original file is a media asset of the workspace (kind "library"); the
// analysis (transcript, frames, hook, structure, tags) is JSON on the row.
export const libraryItems = createTable(
  "library_item",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    workspaceId: d
      .uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: d.text({ enum: ["video", "audio", "image", "pdf", "text", "article"] }).notNull(),
    title: d.text().notNull(),
    // The link it was saved from, if any.
    sourceUrl: d.text(),
    // The uploaded file's name, if any.
    fileName: d.text(),
    assetId: d.uuid().references(() => mediaAssets.id, { onDelete: "set null" }),
    mimeType: d.text(),
    durationS: d.real(),
    // The words of a pasted text, an article or a PDF.
    body: d.text(),
    // "My content": the user's own work, read for the style profile.
    mine: d.boolean().notNull().default(false),
    status: d.text({ enum: ["queued", "analyzing", "ready", "failed"] }).notNull().default("queued"),
    // The step running now (for the page), and a sentence about what failed
    // or was skipped.
    stage: d.text(),
    problem: d.text(),
    analysis: d.jsonb().$type<ItemAnalysis>(),
    tags: d.text().array().notNull().default(sql`'{}'::text[]`),
    createdAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
    // When the analysis began and ended. A running analysis touches
    // heartbeatAt every half minute: one whose heartbeat stopped was cut short
    // (a restart, a closed tab) and is retried, at most three times in all.
    startedAt: d.timestamp({ withTimezone: true }),
    heartbeatAt: d.timestamp({ withTimezone: true }),
    attempts: d.integer().notNull().default(0),
    analyzedAt: d.timestamp({ withTimezone: true }),
  }),
  (t) => [
    index("library_item_workspace_idx").on(t.workspaceId, t.createdAt),
    index("library_item_status_idx").on(t.status),
    pgPolicy("library_item_member_select", { for: "select", to: authenticated, using: memberOf(t.workspaceId) }),
  ],
).enableRLS();

// The passages search and the library chat read: transcript windows, text
// paragraphs, what the vision model saw, the summary. `embedding` is null
// until an embedding model has read the passage (or when none is set up).
export const libraryChunks = createTable(
  "library_chunk",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    itemId: d
      .uuid()
      .notNull()
      .references(() => libraryItems.id, { onDelete: "cascade" }),
    workspaceId: d.uuid().notNull(),
    index: d.integer().notNull(),
    source: d.text({ enum: ["transcript", "text", "frame", "summary"] }).notNull(),
    text: d.text().notNull(),
    startS: d.real(),
    endS: d.real(),
    // Cosine similarity is computed by the studio (src/modules/library/text.ts),
    // so any Postgres, PGlite included, stores it without an extension.
    embedding: d.real().array(),
    embedModel: d.text(),
  }),
  (t) => [
    index("library_chunk_item_idx").on(t.itemId, t.index),
    index("library_chunk_workspace_idx").on(t.workspaceId, t.embedModel),
    pgPolicy("library_chunk_member_select", { for: "select", to: authenticated, using: memberOf(t.workspaceId) }),
  ],
).enableRLS();

// The library chat: about one item, or the whole library (itemId null).
export const libraryMessages = createTable(
  "library_message",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    workspaceId: d
      .uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    itemId: d.uuid().references(() => libraryItems.id, { onDelete: "cascade" }),
    role: d.text({ enum: ["user", "assistant"] }).notNull(),
    content: d.text().notNull(),
    citations: d.jsonb().$type<Citation[]>().notNull().default([]),
    provider: d.text(),
    model: d.text(),
    createdAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (t) => [
    index("library_message_scope_idx").on(t.workspaceId, t.itemId, t.createdAt),
    pgPolicy("library_message_member_select", { for: "select", to: authenticated, using: memberOf(t.workspaceId) }),
  ],
).enableRLS();

// An idea card: a short script the library wrote from saved items, kept
// until the user makes a project of it.
export const libraryIdeas = createTable(
  "library_idea",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    workspaceId: d
      .uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // The items it came from.
    itemIds: d.uuid().array().notNull().default(sql`'{}'::uuid[]`),
    kind: d.text({ enum: ["ideas", "remix", "script", "repurpose"] }).notNull(),
    title: d.text().notNull(),
    hook: d.text().notNull(),
    lines: d.jsonb().$type<DraftLine[]>().notNull(),
    actorId: d.uuid(),
    language: d.text().notNull().default("en"),
    // The project made from it.
    projectId: d.uuid().references(() => projects.id, { onDelete: "set null" }),
    provider: d.text(),
    model: d.text(),
    createdAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (t) => [
    index("library_idea_workspace_idx").on(t.workspaceId, t.createdAt),
    pgPolicy("library_idea_member_select", { for: "select", to: authenticated, using: memberOf(t.workspaceId) }),
  ],
).enableRLS();
