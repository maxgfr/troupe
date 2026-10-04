CREATE TABLE "troupe_actor_asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actorId" uuid NOT NULL,
	"kind" text NOT NULL,
	"emotion" text,
	"storagePath" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "troupe_actor_asset" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "troupe_actor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspaceId" uuid,
	"name" text NOT NULL,
	"gender" text NOT NULL,
	"ageRange" text NOT NULL,
	"style" text NOT NULL,
	"voiceProfile" text NOT NULL,
	"kind" text NOT NULL,
	"consentRef" uuid,
	"assetVersion" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "troupe_actor" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "troupe_actor_asset" ADD CONSTRAINT "troupe_actor_asset_actorId_troupe_actor_id_fk" FOREIGN KEY ("actorId") REFERENCES "public"."troupe_actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actor_asset_actor_idx" ON "troupe_actor_asset" USING btree ("actorId","version");--> statement-breakpoint
CREATE INDEX "actor_workspace_idx" ON "troupe_actor" USING btree ("workspaceId");--> statement-breakpoint
CREATE POLICY "actor_asset_visible_select" ON "troupe_actor_asset" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from troupe_actor a where a.id = "troupe_actor_asset"."actorId" and (a."workspaceId" is null or exists (select 1 from troupe_workspace_member m where m."workspaceId" = a."workspaceId" and m."userId" = auth.uid()))));--> statement-breakpoint
CREATE POLICY "actor_visible_select" ON "troupe_actor" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("troupe_actor"."workspaceId" is null or exists (select 1 from troupe_workspace_member m where m."workspaceId" = "troupe_actor"."workspaceId" and m."userId" = auth.uid()));