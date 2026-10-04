CREATE TABLE "troupe_reconcile_heartbeat" (
	"id" text PRIMARY KEY NOT NULL,
	"ranAt" timestamp with time zone NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "troupe_reconcile_heartbeat" ENABLE ROW LEVEL SECURITY;