CREATE TABLE "troupe_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspaceId" uuid NOT NULL,
	"stripeCustomerId" text NOT NULL,
	"stripeSubscriptionId" text NOT NULL,
	"plan" text NOT NULL,
	"monthlyCredits" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"renewsAt" timestamp with time zone,
	CONSTRAINT "troupe_subscription_stripeSubscriptionId_unique" UNIQUE("stripeSubscriptionId")
);
--> statement-breakpoint
ALTER TABLE "troupe_subscription" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "troupe_subscription" ADD CONSTRAINT "troupe_subscription_workspaceId_troupe_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."troupe_workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "subscription_member_select" ON "troupe_subscription" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from troupe_workspace_member m where m."workspaceId" = "troupe_subscription"."workspaceId" and m."userId" = auth.uid()));