ALTER TABLE "troupe_project" ADD COLUMN "kind" text DEFAULT 'project' NOT NULL;--> statement-breakpoint
ALTER TABLE "troupe_generation" ADD COLUMN "favoritedAt" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "project_one_shots_idx" ON "troupe_project" USING btree ("workspaceId") WHERE "troupe_project"."kind" = 'shots';