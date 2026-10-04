CREATE TABLE "troupe_project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspaceId" uuid NOT NULL,
	"title" text NOT NULL,
	"format" text NOT NULL,
	"platform" text NOT NULL,
	"language" text NOT NULL,
	"actorId" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "troupe_project" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "troupe_script_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scriptId" uuid NOT NULL,
	"index" integer NOT NULL,
	"role" text NOT NULL,
	"text" text NOT NULL,
	"emotion" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "troupe_script_line" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "troupe_script" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"projectId" uuid NOT NULL,
	"version" integer NOT NULL,
	"origin" text NOT NULL,
	"estimatedDurationS" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "troupe_script" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "troupe_project" ADD CONSTRAINT "troupe_project_workspaceId_troupe_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."troupe_workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "troupe_script_line" ADD CONSTRAINT "troupe_script_line_scriptId_troupe_script_id_fk" FOREIGN KEY ("scriptId") REFERENCES "public"."troupe_script"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "troupe_script" ADD CONSTRAINT "troupe_script_projectId_troupe_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."troupe_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_workspace_idx" ON "troupe_project" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "script_line_script_idx" ON "troupe_script_line" USING btree ("scriptId","index");--> statement-breakpoint
CREATE UNIQUE INDEX "script_project_version_unique" ON "troupe_script" USING btree ("projectId","version");--> statement-breakpoint
CREATE POLICY "project_member_select" ON "troupe_project" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from troupe_workspace_member m where m."workspaceId" = "troupe_project"."workspaceId" and m."userId" = auth.uid()));--> statement-breakpoint
CREATE POLICY "script_line_member_select" ON "troupe_script_line" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from troupe_script s join troupe_project p on p.id = s."projectId" join troupe_workspace_member m on m."workspaceId" = p."workspaceId" where s.id = "troupe_script_line"."scriptId" and m."userId" = auth.uid()));--> statement-breakpoint
CREATE POLICY "script_member_select" ON "troupe_script" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from troupe_project p join troupe_workspace_member m on m."workspaceId" = p."workspaceId" where p.id = "troupe_script"."projectId" and m."userId" = auth.uid()));