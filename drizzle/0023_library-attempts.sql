ALTER TABLE "troupe_library_item" ADD COLUMN "heartbeatAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "troupe_library_item" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;