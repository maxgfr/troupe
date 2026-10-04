CREATE TABLE "troupe_chat_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"projectId" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"proposal" jsonb,
	"baseScriptId" uuid,
	"appliedScriptId" uuid,
	"provider" text,
	"model" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "troupe_chat_message" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "troupe_studio_settings" ADD COLUMN "chat" jsonb;--> statement-breakpoint
ALTER TABLE "troupe_chat_message" ADD CONSTRAINT "troupe_chat_message_projectId_troupe_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."troupe_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "troupe_chat_message" ADD CONSTRAINT "troupe_chat_message_baseScriptId_troupe_script_id_fk" FOREIGN KEY ("baseScriptId") REFERENCES "public"."troupe_script"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "troupe_chat_message" ADD CONSTRAINT "troupe_chat_message_appliedScriptId_troupe_script_id_fk" FOREIGN KEY ("appliedScriptId") REFERENCES "public"."troupe_script"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_message_project_idx" ON "troupe_chat_message" USING btree ("projectId","createdAt");--> statement-breakpoint
CREATE POLICY "chat_message_member_select" ON "troupe_chat_message" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from troupe_project p join troupe_workspace_member m on m."workspaceId" = p."workspaceId" where p.id = "troupe_chat_message"."projectId" and m."userId" = auth.uid()));