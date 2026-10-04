CREATE TABLE "troupe_media_asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspaceId" uuid NOT NULL,
	"kind" text NOT NULL,
	"storagePath" text NOT NULL,
	"mimeType" text NOT NULL,
	"bytes" bigint NOT NULL,
	"checksum" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "troupe_media_asset" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "troupe_upload_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspaceId" uuid NOT NULL,
	"kind" text NOT NULL,
	"mimeType" text NOT NULL,
	"bytesTotal" bigint NOT NULL,
	"bytesConfirmed" bigint DEFAULT 0 NOT NULL,
	"storagePath" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "troupe_upload_session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "media_asset_workspace_idx" ON "troupe_media_asset" USING btree ("workspaceId");--> statement-breakpoint
CREATE POLICY "media_asset_member_select" ON "troupe_media_asset" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from troupe_workspace_member m where m."workspaceId" = "troupe_media_asset"."workspaceId" and m."userId" = auth.uid()));