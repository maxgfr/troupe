CREATE TABLE "troupe_benchmark_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"benchmarkRunId" uuid NOT NULL,
	"generationId" uuid NOT NULL,
	"qualityVotes" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "troupe_benchmark_entry" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "troupe_benchmark_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspaceId" uuid NOT NULL,
	"brief" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "troupe_benchmark_run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "troupe_benchmark_entry" ADD CONSTRAINT "troupe_benchmark_entry_benchmarkRunId_troupe_benchmark_run_id_fk" FOREIGN KEY ("benchmarkRunId") REFERENCES "public"."troupe_benchmark_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "troupe_benchmark_entry" ADD CONSTRAINT "troupe_benchmark_entry_generationId_troupe_generation_id_fk" FOREIGN KEY ("generationId") REFERENCES "public"."troupe_generation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "troupe_benchmark_run" ADD CONSTRAINT "troupe_benchmark_run_workspaceId_troupe_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."troupe_workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "benchmark_entry_run_idx" ON "troupe_benchmark_entry" USING btree ("benchmarkRunId");--> statement-breakpoint
CREATE POLICY "benchmark_run_member_select" ON "troupe_benchmark_run" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from troupe_workspace_member m where m."workspaceId" = "troupe_benchmark_run"."workspaceId" and m."userId" = auth.uid()));