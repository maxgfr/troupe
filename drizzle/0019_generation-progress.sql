ALTER TABLE "troupe_generation" ADD COLUMN "progress" real;--> statement-breakpoint
ALTER TABLE "troupe_generation" ADD COLUMN "burnedCaptions" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- A render is a draft until it is exported; the exported one is final.
UPDATE "troupe_generation" g SET "tier" = CASE WHEN EXISTS (SELECT 1 FROM "troupe_export" e WHERE e."generationId" = g."id") THEN 'final' ELSE 'draft' END;--> statement-breakpoint
-- The browser edition's renderer always draws the captions into the picture.
UPDATE "troupe_generation" SET "burnedCaptions" = true WHERE "provider" = 'browser';
