CREATE TABLE "troupe_user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"displayName" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "troupe_workspace_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspaceId" uuid NOT NULL,
	"userId" uuid NOT NULL,
	"role" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "troupe_workspace_member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "troupe_workspace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"ownerId" uuid NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "troupe_workspace" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "troupe_workspace_member" ADD CONSTRAINT "troupe_workspace_member_workspaceId_troupe_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."troupe_workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_member_unique" ON "troupe_workspace_member" USING btree ("workspaceId","userId");--> statement-breakpoint
CREATE INDEX "workspace_member_user_idx" ON "troupe_workspace_member" USING btree ("userId");--> statement-breakpoint
CREATE POLICY "workspace_member_self_select" ON "troupe_workspace_member" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("troupe_workspace_member"."userId" = auth.uid());--> statement-breakpoint
CREATE POLICY "workspace_member_select" ON "troupe_workspace" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from troupe_workspace_member m where m."workspaceId" = "troupe_workspace"."id" and m."userId" = auth.uid()));