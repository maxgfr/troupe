-- Legacy SaaS tables (approval, review_comment, credit_ledger_entry,
-- subscription, provider_webhook_event, upload_session) are intentionally
-- kept: existing installations keep their data. Their TypeScript definitions
-- are gone, so the snapshot no longer lists them.
ALTER TABLE "troupe_provider_settings" ALTER COLUMN "apiKey" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "troupe_provider_settings" ADD COLUMN "apiKeyCiphertext" text;--> statement-breakpoint
ALTER TABLE "troupe_provider_settings" ADD COLUMN "keyFingerprint" text;
