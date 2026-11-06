ALTER TABLE "troupe_generation" ADD COLUMN "medium" text DEFAULT 'video' NOT NULL;--> statement-breakpoint
ALTER TABLE "troupe_generation" ADD COLUMN "options" jsonb;