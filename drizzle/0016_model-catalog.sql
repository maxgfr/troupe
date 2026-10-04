CREATE TABLE "troupe_model_config" (
	"id" text PRIMARY KEY NOT NULL,
	"family" text NOT NULL,
	"label" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"defaults" jsonb,
	"pricePerSecondUsd" numeric,
	"timeoutS" integer,
	"capabilities" jsonb,
	"connection" jsonb,
	"secretCiphertext" text,
	"secretFingerprint" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "troupe_model_config" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "troupe_studio_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"defaultModelKey" text,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "troupe_studio_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Every existing row gets the catalog key of the model it was launched on.
-- Retired providers keep a recognisable, unroutable key.
ALTER TABLE "troupe_project" ADD COLUMN "modelKey" text;--> statement-breakpoint
UPDATE "troupe_project" SET "modelKey" = CASE "providerId"
	WHEN 'veo' THEN 'veo-3.1-fast'
	WHEN 'kling' THEN 'kling-3.0'
	WHEN 'seedance' THEN 'seedance-1.5-pro'
	ELSE NULL END;--> statement-breakpoint
ALTER TABLE "troupe_generation" ADD COLUMN "modelKey" text;--> statement-breakpoint
UPDATE "troupe_generation" SET "modelKey" = CASE "provider"
	WHEN 'veo' THEN 'veo-3.1-fast'
	WHEN 'kling' THEN 'kling-3.0'
	WHEN 'seedance' THEN 'seedance-1.5-pro'
	ELSE 'legacy-' || "provider" END;--> statement-breakpoint
ALTER TABLE "troupe_generation" ALTER COLUMN "modelKey" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "troupe_generation" ADD COLUMN "costSource" text;--> statement-breakpoint
UPDATE "troupe_generation" SET "costSource" = 'provider' WHERE "costUsd" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "troupe_generation" ADD COLUMN "errorDetail" text;--> statement-breakpoint
ALTER TABLE "troupe_generation_watch" ADD COLUMN "modelKey" text;--> statement-breakpoint
ALTER TABLE "troupe_generation_watch" ADD COLUMN "deadlineAt" timestamp with time zone;--> statement-breakpoint
-- In-flight jobs keep the 30-minute deadline they were submitted under.
UPDATE "troupe_generation_watch" w SET
	"modelKey" = g."modelKey",
	"deadlineAt" = w."createdAt" + interval '30 minutes'
	FROM "troupe_generation" g WHERE g."id" = w."generationId";--> statement-breakpoint
ALTER TABLE "troupe_generation_watch" ALTER COLUMN "modelKey" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "troupe_generation_watch" ALTER COLUMN "deadlineAt" SET NOT NULL;
