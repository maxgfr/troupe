CREATE TABLE "troupe_generation_watch" (
	"generationId" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"providerJobId" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"nextPollAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "troupe_generation_watch" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "troupe_generation_watch" ADD CONSTRAINT "troupe_generation_watch_generationId_troupe_generation_id_fk" FOREIGN KEY ("generationId") REFERENCES "public"."troupe_generation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_watch_due_idx" ON "troupe_generation_watch" USING btree ("nextPollAt");