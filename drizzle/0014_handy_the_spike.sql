CREATE TABLE "troupe_provider_settings" (
	"provider" text PRIMARY KEY NOT NULL,
	"apiKey" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "troupe_provider_settings" ENABLE ROW LEVEL SECURITY;