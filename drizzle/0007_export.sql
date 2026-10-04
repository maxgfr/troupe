CREATE TABLE "troupe_export" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"projectId" uuid NOT NULL,
	"generationId" uuid NOT NULL,
	"platform" text NOT NULL,
	"filePath" text NOT NULL,
	"caption" text NOT NULL,
	"hashtags" text[] NOT NULL,
	"aiDisclosure" boolean DEFAULT true NOT NULL,
	"qualityConfirmedBy" uuid,
	"approvalId" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "troupe_export" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "troupe_export" ADD CONSTRAINT "troupe_export_projectId_troupe_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."troupe_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "troupe_export" ADD CONSTRAINT "troupe_export_generationId_troupe_generation_id_fk" FOREIGN KEY ("generationId") REFERENCES "public"."troupe_generation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "export_project_idx" ON "troupe_export" USING btree ("projectId");--> statement-breakpoint
CREATE POLICY "export_member_select" ON "troupe_export" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from troupe_project p join troupe_workspace_member m on m."workspaceId" = p."workspaceId" where p.id = "troupe_export"."projectId" and m."userId" = auth.uid()));