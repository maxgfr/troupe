CREATE TABLE "troupe_approval" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"projectId" uuid NOT NULL,
	"generationId" uuid NOT NULL,
	"reviewerId" uuid NOT NULL,
	"decision" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "troupe_approval" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "troupe_review_comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"projectId" uuid NOT NULL,
	"generationId" uuid,
	"authorId" uuid NOT NULL,
	"text" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "troupe_review_comment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "troupe_approval" ADD CONSTRAINT "troupe_approval_projectId_troupe_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."troupe_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "troupe_review_comment" ADD CONSTRAINT "troupe_review_comment_projectId_troupe_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."troupe_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_generation_idx" ON "troupe_approval" USING btree ("generationId");--> statement-breakpoint
CREATE INDEX "review_comment_project_idx" ON "troupe_review_comment" USING btree ("projectId");--> statement-breakpoint
CREATE POLICY "approval_member_select" ON "troupe_approval" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from troupe_project p join troupe_workspace_member m on m."workspaceId" = p."workspaceId" where p.id = "troupe_approval"."projectId" and m."userId" = auth.uid()));--> statement-breakpoint
CREATE POLICY "review_comment_member_select" ON "troupe_review_comment" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from troupe_project p join troupe_workspace_member m on m."workspaceId" = p."workspaceId" where p.id = "troupe_review_comment"."projectId" and m."userId" = auth.uid()));