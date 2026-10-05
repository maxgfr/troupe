CREATE TABLE "troupe_library_chunk" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"itemId" uuid NOT NULL,
	"workspaceId" uuid NOT NULL,
	"index" integer NOT NULL,
	"source" text NOT NULL,
	"text" text NOT NULL,
	"startS" real,
	"endS" real,
	"embedding" real[],
	"embedModel" text
);
--> statement-breakpoint
ALTER TABLE "troupe_library_chunk" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "troupe_library_idea" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspaceId" uuid NOT NULL,
	"itemIds" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"hook" text NOT NULL,
	"lines" jsonb NOT NULL,
	"actorId" uuid,
	"language" text DEFAULT 'en' NOT NULL,
	"projectId" uuid,
	"provider" text,
	"model" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "troupe_library_idea" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "troupe_library_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspaceId" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"sourceUrl" text,
	"fileName" text,
	"assetId" uuid,
	"mimeType" text,
	"durationS" real,
	"body" text,
	"mine" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"stage" text,
	"problem" text,
	"analysis" jsonb,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"startedAt" timestamp with time zone,
	"analyzedAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "troupe_library_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "troupe_library_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspaceId" uuid NOT NULL,
	"itemId" uuid,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" text,
	"model" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "troupe_library_message" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "troupe_library_chunk" ADD CONSTRAINT "troupe_library_chunk_itemId_troupe_library_item_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."troupe_library_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "troupe_library_idea" ADD CONSTRAINT "troupe_library_idea_workspaceId_troupe_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."troupe_workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "troupe_library_idea" ADD CONSTRAINT "troupe_library_idea_projectId_troupe_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."troupe_project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "troupe_library_item" ADD CONSTRAINT "troupe_library_item_workspaceId_troupe_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."troupe_workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "troupe_library_item" ADD CONSTRAINT "troupe_library_item_assetId_troupe_media_asset_id_fk" FOREIGN KEY ("assetId") REFERENCES "public"."troupe_media_asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "troupe_library_message" ADD CONSTRAINT "troupe_library_message_workspaceId_troupe_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."troupe_workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "troupe_library_message" ADD CONSTRAINT "troupe_library_message_itemId_troupe_library_item_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."troupe_library_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "library_chunk_item_idx" ON "troupe_library_chunk" USING btree ("itemId","index");--> statement-breakpoint
CREATE INDEX "library_chunk_workspace_idx" ON "troupe_library_chunk" USING btree ("workspaceId","embedModel");--> statement-breakpoint
CREATE INDEX "library_idea_workspace_idx" ON "troupe_library_idea" USING btree ("workspaceId","createdAt");--> statement-breakpoint
CREATE INDEX "library_item_workspace_idx" ON "troupe_library_item" USING btree ("workspaceId","createdAt");--> statement-breakpoint
CREATE INDEX "library_item_status_idx" ON "troupe_library_item" USING btree ("status");--> statement-breakpoint
CREATE INDEX "library_message_scope_idx" ON "troupe_library_message" USING btree ("workspaceId","itemId","createdAt");--> statement-breakpoint
CREATE POLICY "library_chunk_member_select" ON "troupe_library_chunk" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from troupe_workspace_member m where m."workspaceId" = "troupe_library_chunk"."workspaceId" and m."userId" = auth.uid()));--> statement-breakpoint
CREATE POLICY "library_idea_member_select" ON "troupe_library_idea" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from troupe_workspace_member m where m."workspaceId" = "troupe_library_idea"."workspaceId" and m."userId" = auth.uid()));--> statement-breakpoint
CREATE POLICY "library_item_member_select" ON "troupe_library_item" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from troupe_workspace_member m where m."workspaceId" = "troupe_library_item"."workspaceId" and m."userId" = auth.uid()));--> statement-breakpoint
CREATE POLICY "library_message_member_select" ON "troupe_library_message" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from troupe_workspace_member m where m."workspaceId" = "troupe_library_message"."workspaceId" and m."userId" = auth.uid()));