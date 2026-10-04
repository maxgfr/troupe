CREATE TABLE "troupe_credit_ledger_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspaceId" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"generationId" uuid,
	"stripeEventId" text,
	"expiresAt" timestamp with time zone,
	"balanceAfter" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "troupe_credit_ledger_entry" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "troupe_credit_ledger_entry" ADD CONSTRAINT "troupe_credit_ledger_entry_workspaceId_troupe_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."troupe_workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_ledger_workspace_idx" ON "troupe_credit_ledger_entry" USING btree ("workspaceId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_stripe_event_unique" ON "troupe_credit_ledger_entry" USING btree ("stripeEventId");--> statement-breakpoint
CREATE POLICY "credit_ledger_member_select" ON "troupe_credit_ledger_entry" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from troupe_workspace_member m where m."workspaceId" = "troupe_credit_ledger_entry"."workspaceId" and m."userId" = auth.uid()));