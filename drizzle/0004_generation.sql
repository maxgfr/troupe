CREATE TABLE "troupe_generation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"projectId" uuid NOT NULL,
	"provider" text NOT NULL,
	"modelId" text NOT NULL,
	"inputMode" text NOT NULL,
	"tier" text NOT NULL,
	"inputAssetId" uuid,
	"scriptId" uuid,
	"prompt" text NOT NULL,
	"aspectRatio" text NOT NULL,
	"durationS" integer NOT NULL,
	"resolution" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"providerJobId" text,
	"costUsd" numeric,
	"creditsDebited" integer DEFAULT 0 NOT NULL,
	"outputAssetId" uuid,
	"errorCode" text,
	"language" text,
	"parentGenerationId" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"completedAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "troupe_generation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "troupe_provider_webhook_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"eventType" text NOT NULL,
	"providerJobId" text NOT NULL,
	"payloadHash" text NOT NULL,
	"receivedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"processedAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "troupe_provider_webhook_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "troupe_generation" ADD CONSTRAINT "troupe_generation_projectId_troupe_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."troupe_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_project_idx" ON "troupe_generation" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "generation_provider_job_idx" ON "troupe_generation" USING btree ("provider","providerJobId");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_webhook_payload_unique" ON "troupe_provider_webhook_event" USING btree ("payloadHash");--> statement-breakpoint
CREATE POLICY "generation_member_select" ON "troupe_generation" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from troupe_project p join troupe_workspace_member m on m."workspaceId" = p."workspaceId" where p.id = "troupe_generation"."projectId" and m."userId" = auth.uid()));